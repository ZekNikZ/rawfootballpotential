import RecordCategorySection from "../components/RecordCategorySection";

function OverallRecordsPage() {
  return (
    <RecordCategorySection
      category={{
        name: "Test Category",
        children: [
          {
            name: "Test Record 1",
            dataAvailableFromYear: 2011,
            columns: [
              {
                key: "colA",
                title: "Name",
                type: "string",
              },
              {
                key: "colB",
                hintKey: "hint",
                title: "Value",
                type: "number",
                decimalPrecision: 2,
                important: true,
              },
            ],
            keyField: "colA",
            entries: [
              {
                colA: "aaa",
                colB: 111,
                hint: "11-11",
                league: "L-Redraft-2022",
                scope: "in-season",
              },
              {
                colA: "bbb",
                colB: 222,
                hint: "22-22",
                league: "L-Redraft-2022",
                scope: "playoffs",
              },
              {
                colA: "ccc",
                colB: 333,
                hint: "33-33",
                league: "L-Redraft-2023",
                scope: "in-season",
              },
              {
                colA: "ddd",
                colB: 444,
                hint: "44-44",
                league: "L-Redraft-2023",
                scope: "playoffs",
              },
            ],
          },
          {
            name: "Test Record 2",
            dataAvailableFromYear: 2012,
            columns: [
              {
                key: "colA",
                title: "Name",
                type: "string",
              },
              {
                key: "colB",
                hintKey: "hint",
                title: "Value",
                type: "number",
                decimalPrecision: 2,
                important: true,
              },
            ],
            keyField: "colA",
            entries: [
              {
                colA: "aaa",
                colB: 111,
                hint: "11-11",
                league: "L-Redraft-2023",
                scope: "in-season",
              },
              {
                colA: "bbb",
                colB: 222,
                hint: "22-22",
                league: "L-Redraft-2023",
                scope: "playoffs",
              },
              {
                colA: "ccc",
                colB: 333,
                hint: "33-33",
                league: "L-Redraft-2023",
                scope: "in-season",
              },
              {
                colA: "ddd",
                colB: 444,
                hint: "44-44",
                league: "L-Redraft-2023",
                scope: "playoffs",
              },
            ],
          },
          {
            name: "Test Record 3",
            dataAvailableFromYear: 2012,
            columns: [
              {
                key: "colA",
                title: "Name",
                type: "string",
              },
              {
                key: "colB",
                hintKey: "hint",
                title: "Value",
                type: "number",
                decimalPrecision: 2,
                important: true,
              },
            ],
            keyField: "colA",
            entries: [
              {
                colA: "aaa",
                colB: 111,
                hint: "11-11",
                league: "L-Redraft-2022",
                scope: null,
              },
              {
                colA: "bbb",
                colB: 222,
                hint: "22-22",
                league: "L-Redraft-2022",
                scope: null,
              },
              {
                colA: "ccc",
                colB: 333,
                hint: "33-33",
                league: "L-Redraft-2023",
                scope: null,
              },
              {
                colA: "ddd",
                colB: 444,
                hint: "44-44",
                league: "L-Redraft-2023",
                scope: null,
              },
            ],
          },
          {
            name: "Test Record 4",
            dataAvailableFromYear: 2012,
            columns: [
              {
                key: "colA",
                title: "Name",
                type: "string",
              },
              {
                key: "colB",
                hintKey: "hint",
                title: "Value",
                type: "number",
                decimalPrecision: 2,
                important: true,
              },
            ],
            keyField: "colA",
            entries: [
              {
                colA: "aaa",
                colB: 111,
                hint: "11-11",
                league: null,
                scope: null,
              },
              {
                colA: "bbb",
                colB: 222,
                hint: "22-22",
                league: null,
                scope: null,
              },
              {
                colA: "ccc",
                colB: 333,
                hint: "33-33",
                league: null,
                scope: null,
              },
              {
                colA: "ddd",
                colB: 444,
                hint: "44-44",
                league: null,
                scope: null,
              },
            ],
          },
        ],
      }}
    />
  );
}

export default OverallRecordsPage;
