import { ManagerId } from "./ids";

export interface Manager {
  managerId: ManagerId;
  name: string;
  avatar?: string;
}
