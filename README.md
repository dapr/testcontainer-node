# Dapr TestContainer for NodeJS

Dapr is a CNCF and open-source project that enables developers with consistent application-level APIs to develop
secure, scalable, and resilient cloud-native applications.

The Testcontainers Dapr module for NodeJS enables local development and testing of Dapr-enabled applications by
providing a DaprContainer that sets up a Dapr sidecar instance. This container provides an in-memory implementation of
Dapr APIs by default, facilitating testing without requiring a full Dapr installation or external dependencies.

A usage example can be found in [`src/DaprContainer.test.ts`](https://github.com/dapr/testcontainer-node/blob/main/src/DaprContainer.test.ts)

## Using the library

To use this library, add the dependency to your project:

```shell
npm install --save-dev @dapr/testcontainer-node
```

## Versions

This library follows [Semantic Versioning](https://semver.org/).
