import { LeagueDefinition } from "./config";
import { LeagueId } from "./ids";
import { League } from "./leagues";

type RecordType = "overall" | "single-season" | "manager";

export interface RecordCategoryDefinition {
  type: "category";
  category: RecordType;
  name: string;
  children: RecordDefinition[];
}

export interface RecordDefinition {
  type: "record";
  category: RecordType;
  name: string;
  displayAll?: boolean;
  isAvailable?: (league: LeagueDefinition) => boolean;
  generateRecord: (
    definition: RecordDefinition,
    league: LeagueDefinition,
    leagues: Record<LeagueId, League>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => FantasyRecord<any>;
}

export interface RecordColumn<T> {
  key: keyof T;
  hintKey?: keyof T;
  title: string;
  important?: boolean;
  type: "string" | "number" | "currency" | "percentage";
  decimalPrecision?: number;
}

export type RecordScope = "in-season" | "playoffs";

export interface BaseRecordEntry {
  league: LeagueId | null;
  scope: RecordScope | null;
}

export interface FantasyRecord<T extends BaseRecordEntry> {
  type: "record";
  category: RecordType;
  name: string;
  displayAll?: boolean;
  dataAvailableFromYear: number;
  columns: RecordColumn<T>[];
  keyField: keyof T;
  entries: T[];
}

export interface RecordCategory {
  type: "category";
  category: RecordType;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children: FantasyRecord<any>[];
}