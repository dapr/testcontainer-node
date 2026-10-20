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

/** JSON-compatible values used by the proto's google.protobuf.Struct fields. */
export type SearchValue = string | number | boolean | null | SearchValue[] | { [key: string]: SearchValue };
export type SearchStruct = { [key: string]: SearchValue };
export type SearchMetadata = Record<string, string>;

export type SearchDocument = {
  id: string;
  /** UTF-8 JSON object bytes; the harness handles base64 encoding on the wire. */
  content: Buffer;
  metadata?: SearchMetadata;
};

export type SearchHit = {
  document: SearchDocument;
  score: number;
  highlights: Record<string, string>;
};

export type IndexAck = "INDEX_ACK_QUEUED" | "INDEX_ACK_COMPLETED";
export type SortOrder = "SORT_ORDER_UNSPECIFIED" | "SORT_ORDER_ASC" | "SORT_ORDER_DESC";
export type TotalHitsRelation =
  | "TOTAL_HITS_RELATION_UNSPECIFIED"
  | "TOTAL_HITS_RELATION_EXACT"
  | "TOTAL_HITS_RELATION_LOWER_BOUND"
  | "TOTAL_HITS_RELATION_ESTIMATE";

export type IndexingOptionsAlpha1 =
  | {
      mode?: "INDEXING_MODE_UNSPECIFIED" | "INDEXING_MODE_RETURN_ON_ACCEPTANCE";
      waitTimeout?: never;
      onWaitTimeout?: never;
    }
  | {
      mode: "INDEXING_MODE_WAIT_FOR_COMPLETION";
      /** Positive protobuf JSON duration, e.g. "10s"; shorter than the request/resiliency deadline. */
      waitTimeout: string;
      onWaitTimeout: "INDEXING_WAIT_TIMEOUT_ACTION_CONTINUE_ASYNC" | "INDEXING_WAIT_TIMEOUT_ACTION_FAIL_REQUEST";
    };

export type FailedItem = {
  id: string;
  error: {
    code: number;
    message: string;
    details?: SearchStruct[];
  };
};

export type IndexDocumentsResponseAlpha1 = {
  failedItems: FailedItem[];
  ack: IndexAck;
};

export type DeleteDocumentsResponseAlpha1 = { ack: IndexAck };
export type GetDocumentsResponseAlpha1 = { documents: SearchDocument[] };
export type ListIndexesResponseAlpha1 = { indexes: string[] };
export type GetIndexResponseAlpha1 = {
  index: string;
  /** Protobuf uint64 values remain strings to avoid loss of precision. */
  documentCount: string;
  properties: SearchMetadata;
};

export type SearchQuery = ({ text?: string; native?: never } | { text?: never; native: SearchStruct }) & {
  filter?: SearchStruct;
  topK?: number;
  continuationToken?: string;
  returnFields?: string[];
  includeContent?: boolean;
  searchFields?: string[];
  sort?: { field: string; order: SortOrder }[];
  highlightFields?: string[];
};

export type SearchResponseAlpha1 = {
  hits: SearchHit[];
  /** Protobuf uint64 values remain strings to avoid loss of precision. */
  totalHits?: string;
  continuationToken?: string;
  totalHitsRelation: TotalHitsRelation;
};

export type SearchWriteOptions = {
  metadata?: SearchMetadata;
  options?: IndexingOptionsAlpha1;
};
