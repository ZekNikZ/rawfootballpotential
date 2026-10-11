import { CategoryPage } from "../components/records/CategoryPage";
import { Heatmap } from "../components/records/Heatmap";
import { PlacementChart } from "../components/records/PlacementChart";
import { TradePartners } from "../components/records/TradePartners";

export default function ManagerRecords() {
  return (
    <CategoryPage category="manager" exclude={["Power Rankings"]}>
      <Heatmap />
      <TradePartners />
      <PlacementChart />
    </CategoryPage>
  );
}
