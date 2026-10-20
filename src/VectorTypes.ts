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

import { FailedItem, IndexAck, IndexingOptionsAlpha1, SearchMetadata, SearchStruct } from "./SearchTypes";

export type VectorMetadata = SearchMetadata;
export type VectorStruct = SearchStruct;

export type DistanceMetric =
  | "DISTANCE_METRIC_UNSPECIFIED"
  | "DISTANCE_METRIC_COSINE"
  | "DISTANCE_METRIC_DOT_PRODUCT"
  | "DISTANCE_METRIC_EUCLIDEAN";

export type VectorRecord = {
  id: string;
  values: number[];
  /** Opaque bytes; the harness handles base64 encoding on the wire. */
  payload?: Buffer;
  /** Structured, filterable attributes, unlike request/component metadata. */
  metadata?: VectorStruct;
};

export type VectorMatch = { record: VectorRecord; score: number };

export type CreateCollectionOptions = {
  metric?: DistanceMetric;
  metadata?: VectorMetadata;
};

export type GetCollectionResponseAlpha1 = {
  collection: string;
  /** Protobuf uint64 values remain strings to avoid loss of precision. */
  recordCount: string;
  properties: VectorMetadata;
  dimensions: number;
  metric: DistanceMetric;
};

export type ListCollectionsResponseAlpha1 = { collections: string[] };
export type UpsertVectorsResponseAlpha1 = { failedItems: FailedItem[]; ack: IndexAck };
export type DeleteVectorsResponseAlpha1 = { ack: IndexAck };
export type GetVectorsResponseAlpha1 = { records: VectorRecord[] };

export type VectorWriteOptions = {
  metadata?: VectorMetadata;
  options?: IndexingOptionsAlpha1;
};

export type VectorQuery = (
  { vector: Pick<VectorRecord, "values">; byId?: never } | { vector?: never; byId: string }
) & {
  topK?: number;
  filter?: VectorStruct;
  includeValues?: boolean;
  includePayload?: boolean;
  metric?: DistanceMetric;
  /** Inclusive cutoff in the effective metric's units, not a normalized score. */
  scoreThreshold?: number;
};

export type QueryVectorsResponseAlpha1 = {
  matches: VectorMatch[];
  metric: DistanceMetric;
};

export type BatchQueryResultAlpha1 =
  { response: QueryVectorsResponseAlpha1; error?: never } | { response?: never; error: FailedItem["error"] };

export type BatchQueryVectorsResponseAlpha1 = { results: BatchQueryResultAlpha1[] };
