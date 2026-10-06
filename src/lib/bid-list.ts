import type { SortingState, ColumnFiltersState } from "@tanstack/react-table";
import type { Row } from "./database.types";

export type BidListQuery = {
  search: string;
  status: string;
  arrangement: string;
  resume: string;
  bidder: string;
  source: string;
  job: string;
  columnFilters: ColumnFiltersState;
  sorting: SortingState;
  pageIndex: number;
  pageSize: number;
};

export type BidListResult = {
  rows: Row<"bids">[];
  total: number;
  sources: string[];
  statusCounts: Record<string, number>;
};
