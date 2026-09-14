/*
Copyright 2025 The Dapr Authors
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import assert from "node:assert";
import fs from "node:fs";
import {
  AbstractStartedContainer,
  GenericContainer,
  log,
  StartedNetwork,
  StartedTestContainer,
  StopOptions,
  StoppedTestContainer,
  Wait,
} from "testcontainers";
import { Component } from "./Component";
import { Configuration } from "./Configuration";
import {
  DAPR_RUNTIME_VERSION_ENV_VAR,
  DaprComponentNames,
  DEFAULT_DAPR_VERSION,
  getDaprPlacementImage,
  getDaprRuntimeImage,
  getDaprSchedulerImage,
  getDaprVersion,
} from "./Constants";
import { DaprPlacementContainer } from "./DaprPlacementContainer";
import { DaprSchedulerContainer } from "./DaprSchedulerContainer";
import { HttpEndpoint } from "./HttpEndpoint";
import { OLLAMA_DEFAULT_MODEL, OLLAMA_DEFAULT_PORT, OllamaContainer, StartedOllamaContainer } from "./OllamaContainer";
import { REDIS_DEFAULT_PORT, RedisContainer } from "./RedisContainer";
import { Subscription } from "./Subscription";

export {
  DAPR_RUNTIME_VERSION_ENV_VAR,
  DaprComponentNames,
  DEFAULT_DAPR_VERSION,
  getDaprPlacementImage,
  getDaprRuntimeImage,
  getDaprSchedulerImage,
  getDaprVersion,
};

export const DAPR_VERSION = DEFAULT_DAPR_VERSION;
export const DAPR_RUNTIME_IMAGE = getDaprRuntimeImage();
export const DAPR_PLACEMENT_IMAGE = getDaprPlacementImage();
export const DAPR_SCHEDULER_IMAGE = getDaprSchedulerImage();

export const DAPRD_DEFAULT_HTTP_PORT = 3500;
export const DAPRD_DEFAULT_GRPC_PORT = 50001;
export const DAPR_PROTOCOL = "http";

export type WorkflowOptions = {
  stateStoreName?: string;
  redisContainer?: RedisContainer;
  redisHost?: string;
  enableActorStateStore?: boolean;
};

export type ConversationOptions = {
  conversationComponentName?: string;
  model?: string;
  cacheTtl?: string;
  ollamaContainer?: OllamaContainer;
  ollamaEndpoint?: string;
  ollamaHost?: string;
  ollamaPort?: number;
};

export class DaprContainer extends GenericContainer {
  private daprLogLevel = "info";
  private daprApiLogging = false;
  private appName = "dapr-app";
  private appChannelAddress?: string; // "host.testcontainers.internal"
  private appPort?: number;
  private appHealthCheckPath?: string;
  private placementService = "placement";
  private schedulerService = "scheduler";
  private redisService = "redis";
  private ollamaService = "ollama";
  private placementImage = getDaprPlacementImage();
  private schedulerImage = getDaprSchedulerImage();
  private placementContainer?: DaprPlacementContainer;
  private schedulerContainer?: DaprSchedulerContainer;
  private redisContainer?: RedisContainer;
  private ollamaContainer?: OllamaContainer;
  private shouldReusePlacement = false;
  private shouldReuseScheduler = false;
  private shouldReuseRedis = false;
  private shouldReuseOllama = false;
  private workflowEnabled = false;
  private workflowOptions?: WorkflowOptions;
  private conversationEnabled = false;
  private conversationOptions?: ConversationOptions;
  private startedNetwork?: StartedNetwork;
  private configuration?: Configuration;
  private components: Component[] = [];
  private subscriptions: Subscription[] = [];
  private httpEndpoints: HttpEndpoint[] = [];

  constructor(image: string = getDaprRuntimeImage()) {
    super(image);
    this.withExposedPorts(DAPRD_DEFAULT_HTTP_PORT, DAPRD_DEFAULT_GRPC_PORT)
      .withWaitStrategy(
        Wait.forHttp("/v1.0/healthz/outbound", DAPRD_DEFAULT_HTTP_PORT).forStatusCodeMatching(
          (statusCode) => statusCode >= 200 && statusCode <= 399
        )
      )
      .withStartupTimeout(120_000);
  }

  public withNetwork(network: StartedNetwork): this {
    this.startedNetwork = network;
    return super.withNetwork(network);
  }

  public override async start(): Promise<StartedDaprContainer> {
    assert(this.startedNetwork, "Network must be provided before starting the container");
    if (!this.placementContainer) {
      const container = new DaprPlacementContainer(this.placementImage)
        .withNetwork(this.startedNetwork)
        .withNetworkAliases(this.placementService);
      if (this.shouldReusePlacement) {
        container.withReuse().withAutoRemove(false);
      }
      this.placementContainer = container;
    }
    if (!this.schedulerContainer) {
      const container = new DaprSchedulerContainer(this.schedulerImage)
        .withNetwork(this.startedNetwork)
        .withNetworkAliases(this.schedulerService);
      if (this.shouldReuseScheduler) {
        container.withReuse().withAutoRemove(false);
      }
      this.schedulerContainer = container;
    }

    const startTasks: Promise<StartedTestContainer>[] = [
      this.placementContainer.start(),
      this.schedulerContainer.start(),
    ];

    if (this.workflowEnabled || this.redisContainer) {
      if (!this.redisContainer) {
        // Only auto-create Redis if no external host is configured
        if (!this.workflowOptions?.redisHost) {
          const container = new RedisContainer().withNetwork(this.startedNetwork).withNetworkAliases(this.redisService);
          if (this.shouldReuseRedis) {
            container.withReuse().withAutoRemove(false);
          }
          this.redisContainer = container;
        }
      } else {
        // Attach explicitly supplied Redis container to the network and alias
        this.redisContainer.withNetwork(this.startedNetwork).withNetworkAliases(this.redisService);
      }

      if (this.redisContainer) {
        startTasks.push(this.redisContainer.start());
      }
    }

    if (this.conversationEnabled || this.ollamaContainer) {
      if (!this.ollamaContainer && !this.conversationOptions?.ollamaEndpoint && !this.conversationOptions?.ollamaHost) {
        const container = new OllamaContainer().withNetwork(this.startedNetwork).withNetworkAliases(this.ollamaService);
        if (this.shouldReuseOllama) {
          container.withReuse().withAutoRemove(false);
        }
        this.ollamaContainer = container;
      } else if (this.ollamaContainer) {
        this.ollamaContainer.withNetwork(this.startedNetwork).withNetworkAliases(this.ollamaService);
      }

      if (this.ollamaContainer) {
        const model = this.conversationOptions?.model ?? OLLAMA_DEFAULT_MODEL;
        startTasks.push(
          this.ollamaContainer.start().then(async (container) => {
            await container.ensureModel(model);
            return container;
          })
        );
      }
    }

    const containers = await Promise.all(startTasks);
    return new StartedDaprContainer(await super.start(), containers);
  }

  protected override async beforeContainerCreated(): Promise<void> {
    assert(this.placementContainer, "DaprPlacementContainer expected");
    assert(this.schedulerContainer, "DaprSchedulerContainer expected");
    const cmds = [
      "./daprd",
      "--app-id",
      this.appName,
      "--dapr-listen-addresses=0.0.0.0",
      "--app-protocol",
      DAPR_PROTOCOL,
      "--placement-host-address",
      `${this.placementService}:${this.placementContainer.getPort()}`,
      "--scheduler-host-address",
      `${this.schedulerService}:${this.schedulerContainer.getPort()}`,
      "--log-level",
      this.daprLogLevel,
      "--resources-path",
      "/dapr-resources",
    ];

    if (this.appChannelAddress) {
      cmds.push("--app-channel-address", this.appChannelAddress);
    }

    if (this.appPort) {
      cmds.push("--app-port", this.appPort.toString());
    }

    if (this.appHealthCheckPath) {
      cmds.push("--enable-app-health-check", "--app-health-check-path", this.appHealthCheckPath);
    }

    if (this.daprApiLogging) {
      cmds.push("--enable-api-logging");
    }

    if (this.configuration) {
      cmds.push("--config", `/dapr-resources/${this.configuration.name}.yaml`);
    }

    log.info("> `daprd` Command: \n");
    log.info(`\t${JSON.stringify(cmds, undefined, 2)}\n`);

    this.withCommand(cmds);

    if (this.configuration) {
      const configurationYaml = this.configuration.toYaml();
      log.info("> Configuration YAML: \n");
      log.info(`\t\n${configurationYaml}\n`);
      this.withCopyContentToContainer([
        { content: configurationYaml, target: `/dapr-resources/${this.configuration.name}.yaml` },
      ]);
    }

    if (this.workflowEnabled) {
      const stateStoreName = this.workflowOptions?.stateStoreName ?? DaprComponentNames.StateManagementComponentName;
      const alreadyHasStateStore = this.components.some((c) => c.name === stateStoreName);
      if (!alreadyHasStateStore) {
        const redisHost =
          this.workflowOptions?.redisHost ??
          `${this.redisService}:${this.redisContainer ? this.redisContainer.getPort() : REDIS_DEFAULT_PORT}`;
        const redisStateStore = RedisContainer.createStateStoreComponent({
          name: stateStoreName,
          redisHost,
          actorStateStore: this.workflowOptions?.enableActorStateStore ?? true,
        });
        this.components.push(redisStateStore);
      }
    }

    if (this.conversationEnabled) {
      const componentName =
        this.conversationOptions?.conversationComponentName ?? DaprComponentNames.ConversationComponentName;
      if (!this.components.some((component) => component.name === componentName)) {
        const endpoint =
          this.conversationOptions?.ollamaEndpoint ??
          `http://${this.conversationOptions?.ollamaHost ?? this.ollamaService}:${
            this.conversationOptions?.ollamaPort ?? OLLAMA_DEFAULT_PORT
          }/v1`;
        this.components.push(
          OllamaContainer.createConversationComponent({
            name: componentName,
            model: this.conversationOptions?.model,
            cacheTtl: this.conversationOptions?.cacheTtl,
            endpoint,
          })
        );
      }
    }

    const hasState = this.components.some((c) => c.type.startsWith("state."));
    if (!hasState) {
      this.components.push(new Component("kvstore", "state.in-memory", "v1", []));
    }

    const hasPubsub = this.components.some((c) => c.type.startsWith("pubsub."));
    if (!hasPubsub) {
      this.components.push(new Component("pubsub", "pubsub.in-memory", "v1", []));
    }

    if (!this.subscriptions.length) {
      const pubsubComponent = this.components.find((c) => c.type.startsWith("pubsub."));
      if (pubsubComponent) {
        this.subscriptions.push(new Subscription("local", pubsubComponent.name, "topic", undefined, "/events"));
      }
    }

    for (const component of this.components) {
      const componentYaml = component.toYaml();
      log.info("> Component YAML: \n");
      log.info(`\t\n${componentYaml}\n`);
      this.withCopyContentToContainer([{ content: componentYaml, target: `/dapr-resources/${component.name}.yaml` }]);
    }

    for (const subscription of this.subscriptions) {
      const subscriptionYaml = subscription.toYaml();
      log.info("> Subscription YAML: \n");
      log.info(`\t\n${subscriptionYaml}\n`);
      this.withCopyContentToContainer([
        { content: subscriptionYaml, target: `/dapr-resources/${subscription.name}.yaml` },
      ]);
    }

    for (const endpoint of this.httpEndpoints) {
      const endpointYaml = endpoint.toYaml();
      log.info("> HTTPEndpoint YAML: \n");
      log.info(`\t\n${endpointYaml}\n`);
      this.withCopyContentToContainer([{ content: endpointYaml, target: `/dapr-resources/${endpoint.name}.yaml` }]);
    }
  }

  getAppName(): string {
    return this.appName;
  }

  getAppPort(): number | undefined {
    return this.appPort;
  }

  getAppChannelAddress(): string | undefined {
    return this.appChannelAddress;
  }

  getPlacementService(): string {
    return this.placementService;
  }

  getSchedulerService(): string {
    return this.schedulerService;
  }

  getRedisService(): string {
    return this.redisService;
  }

  getRedisContainer(): RedisContainer | undefined {
    return this.redisContainer;
  }

  getOllamaService(): string {
    return this.ollamaService;
  }

  getOllamaContainer(): OllamaContainer | undefined {
    return this.ollamaContainer;
  }

  isWorkflowEnabled(): boolean {
    return this.workflowEnabled;
  }

  isConversationEnabled(): boolean {
    return this.conversationEnabled;
  }

  getConfiguration(): Configuration | undefined {
    return this.configuration;
  }

  getComponents(): Component[] {
    return this.components.slice();
  }

  getSubscriptions(): Subscription[] {
    return this.subscriptions.slice();
  }

  getHttpEndpoints(): HttpEndpoint[] {
    return this.httpEndpoints.slice();
  }

  withAppPort(port: number): this {
    this.appPort = port;
    return this;
  }

  withAppChannelAddress(appChannelAddress: string): this {
    this.appChannelAddress = appChannelAddress;
    return this;
  }

  withAppHealthCheckPath(appHealthCheckPath: string): this {
    this.appHealthCheckPath = appHealthCheckPath;
    return this;
  }

  withConfiguration(configuration: Configuration): this {
    this.configuration = configuration;
    return this;
  }

  withPlacementService(placementService: string): this {
    this.placementService = placementService;
    return this;
  }

  withSchedulerService(schedulerService: string): this {
    this.schedulerService = schedulerService;
    return this;
  }

  withRedisService(redisService: string): this {
    this.redisService = redisService;
    return this;
  }

  withAppName(appName: string): this {
    this.appName = appName;
    return this;
  }

  withDaprLogLevel(daprLogLevel: string): this {
    this.daprLogLevel = daprLogLevel;
    return this;
  }

  withDaprApiLoggingEnabled(enabled: boolean): this {
    this.daprApiLogging = enabled;
    return this;
  }

  withSubscription(subscription: Subscription): this {
    this.subscriptions.push(subscription);
    return this;
  }

  withHttpEndpoint(httpEndpoint: HttpEndpoint): this {
    this.httpEndpoints.push(httpEndpoint);
    return this;
  }

  withPlacementImage(placementImage: string): this {
    this.placementImage = placementImage;
    return this;
  }

  withSchedulerImage(schedulerImage: string): this {
    this.schedulerImage = schedulerImage;
    return this;
  }

  withReusablePlacement(shouldReusePlacement: boolean): this {
    this.shouldReusePlacement = shouldReusePlacement;
    return this;
  }

  withReuseScheduler(shouldReuseScheduler: boolean): this {
    this.shouldReuseScheduler = shouldReuseScheduler;
    return this;
  }

  withReusableRedis(shouldReuseRedis: boolean): this {
    this.shouldReuseRedis = shouldReuseRedis;
    return this;
  }

  withOllamaService(ollamaService: string): this {
    this.ollamaService = ollamaService;
    return this;
  }

  withReusableOllama(shouldReuseOllama: boolean): this {
    this.shouldReuseOllama = shouldReuseOllama;
    return this;
  }

  withPlacementContainer(placementContainer: DaprPlacementContainer): this {
    this.placementContainer = placementContainer;
    return this;
  }

  withSchedulerContainer(schedulerContainer: DaprSchedulerContainer): this {
    this.schedulerContainer = schedulerContainer;
    return this;
  }

  withRedisContainer(redisContainer: RedisContainer, redisService = "redis"): this {
    this.redisContainer = redisContainer;
    this.redisService = redisService;
    return this;
  }

  withOllamaContainer(ollamaContainer: OllamaContainer, ollamaService = "ollama"): this {
    this.ollamaContainer = ollamaContainer;
    this.ollamaService = ollamaService;
    return this;
  }

  withWorkflow(options?: WorkflowOptions): this {
    this.workflowEnabled = true;
    this.workflowOptions = options;
    if (options?.redisContainer) {
      this.redisContainer = options.redisContainer;
    }
    return this;
  }

  withConversation(options?: ConversationOptions): this {
    this.conversationEnabled = true;
    this.conversationOptions = options;
    if (options?.ollamaContainer) {
      this.ollamaContainer = options.ollamaContainer;
    }
    return this;
  }

  withComponent(component: Component): this {
    this.components.push(component);
    return this;
  }

  /**
   * Adds a Dapr component from a YAML file.
   * @param path Path to the YAML file.
   * @return This container.
   */
  withComponentFromPath(path: string): this {
    try {
      const src = fs.readFileSync(path, "utf8");
      return this.withComponent(Component.fromYaml(src));
    } catch {
      log.warn(`Error while reading component from ${path}`);
    }
    return this;
  }
}

export class StartedDaprContainer extends AbstractStartedContainer {
  constructor(
    startedTestContainer: StartedTestContainer,
    private readonly containers: StartedTestContainer[]
  ) {
    super(startedTestContainer);
  }

  async stop(options?: Partial<StopOptions>): Promise<StoppedTestContainer> {
    const stoppedTestContainer = await super.stop(options);
    await Promise.all(this.containers.map((container) => container.stop(options)));
    return stoppedTestContainer;
  }

  getHttpPort(): number {
    return this.getMappedPort(DAPRD_DEFAULT_HTTP_PORT);
  }

  getHttpEndpoint(): string {
    return `http://${this.getHost()}:${this.getMappedPort(DAPRD_DEFAULT_HTTP_PORT)}`;
  }

  getGrpcPort(): number {
    return this.getMappedPort(DAPRD_DEFAULT_GRPC_PORT);
  }

  getGrpcEndpoint(): string {
    return `:${this.getMappedPort(DAPRD_DEFAULT_GRPC_PORT)}`;
  }

  getContainers(): StartedTestContainer[] {
    return this.containers.slice();
  }

  getOllamaContainer(): StartedOllamaContainer | undefined {
    return this.containers.find((container): container is StartedOllamaContainer => {
      return container instanceof StartedOllamaContainer;
    });
  }
}
