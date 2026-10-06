import { CategoryPage } from "../components/records/CategoryPage";
import { Heatmap } from "../components/records/Heatmap";

export default function ManagerRecords() {
  return (
    <CategoryPage category="manager">
      <Heatmap />
    </CategoryPage>
  );
}
