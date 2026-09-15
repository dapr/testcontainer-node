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

import { DaprComponentNames } from "./Constants";
import {
  DEFAULT_CRYPTOGRAPHY_KEYS_PATH,
  LOCAL_STORAGE_CRYPTOGRAPHY_COMPONENT_TYPE,
  LocalStorageCryptographyContainer,
} from "./LocalStorageCryptographyContainer";

describe("LocalStorageCryptographyContainer", () => {
  it("should create a component with default values", () => {
    const component = LocalStorageCryptographyContainer.createComponent();

    expect(component.name).toBe(DaprComponentNames.CryptographyComponentName);
    expect(component.type).toBe(LOCAL_STORAGE_CRYPTOGRAPHY_COMPONENT_TYPE);
    expect(component.version).toBe("v1");
    expect(component.getMetadata()).toEqual([{ name: "path", value: DEFAULT_CRYPTOGRAPHY_KEYS_PATH }]);
  });

  it("should create a component with custom values", () => {
    const component = LocalStorageCryptographyContainer.createComponent({
      name: "custom-crypto",
      keyPath: "/keys",
    });

    expect(component.name).toBe("custom-crypto");
    expect(component.toYaml()).toBe(
      "apiVersion: dapr.io/v1alpha1\n" +
        "kind: Component\n" +
        "metadata:\n" +
        "  name: custom-crypto\n" +
        "spec:\n" +
        "  type: crypto.dapr.localstorage\n" +
        "  version: v1\n" +
        "  metadata:\n" +
        "  - name: path\n" +
        "    value: /keys\n"
    );
  });
});
