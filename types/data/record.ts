import { LeagueDefinition } from "./config";
import { LeagueId } from "./ids";

export interface RecordCategoryDefinition {
  name: string;
  children: RecordDefinition[];
}

export interface RecordDefinition {
  name: string;
  maxEntries?: number;
  isAvailable?: (league: LeagueDefinition) => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateRecord?: (definition: RecordDefinition, league: LeagueDefinition) => Record<any>;
}

export interface RecordColumn<T> {
  key: keyof T;
  hintKey?: keyof T;
  title: string;
  important?: boolean;
  type: "string" | "number" | "currency" | "percentage";
  decimalPrecision?: number;
}

export interface BaseRecordEntry {
  league: LeagueId | null;
  scope: "in-season" | "playoffs" | null;
}

export interface Record<T extends BaseRecordEntry> {
  name: string;
  maxEntries?: number;
  dataAvailableFromYear: number;
  columns: RecordColumn<T>[];
  keyField: keyof T;
  entries: T[];
}

export interface RecordCategory {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children: Record<any>[];
}
