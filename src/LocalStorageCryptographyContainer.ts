/*
Copyright 2026 The Dapr Authors
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

import { Component } from "./Component";
import { DaprComponentNames } from "./Constants";

export const LOCAL_STORAGE_CRYPTOGRAPHY_COMPONENT_TYPE = "crypto.dapr.localstorage";
export const DEFAULT_CRYPTOGRAPHY_KEYS_PATH = "/dapr-crypto-keys";

export type LocalStorageCryptographyOptions = {
  name?: string;
  keyPath?: string;
};

/**
 * Builds Dapr components for the local-storage cryptography implementation.
 *
 * This mirrors the .NET SDK helper; no additional service container is needed
 * because the cryptography component loads keys directly from daprd's filesystem.
 */
export class LocalStorageCryptographyContainer {
  public static createComponent(options: LocalStorageCryptographyOptions = {}): Component {
    return new Component(
      options.name ?? DaprComponentNames.CryptographyComponentName,
      LOCAL_STORAGE_CRYPTOGRAPHY_COMPONENT_TYPE,
      "v1",
      [{ name: "path", value: options.keyPath ?? DEFAULT_CRYPTOGRAPHY_KEYS_PATH }]
    );
  }
}
