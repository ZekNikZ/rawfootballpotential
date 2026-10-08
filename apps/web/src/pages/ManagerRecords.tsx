import { CategoryPage } from "../components/records/CategoryPage";
import { Heatmap } from "../components/records/Heatmap";
import { PlacementChart } from "../components/records/PlacementChart";

export default function ManagerRecords() {
  return (
    <CategoryPage category="manager" exclude={["Power Rankings"]}>
      <Heatmap />
      <PlacementChart />
    </CategoryPage>
  );
}
