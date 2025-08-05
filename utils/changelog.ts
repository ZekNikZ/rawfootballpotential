interface ChangelogEntry {
  version: string;
  date: Date;
  title: string;
  description: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.4.0",
    date: new Date(2025, 7, 4),
    title: "Manager matchup and placement records",
    description: `
**Records**
- Add placement and manager matchup records.
- (From 1.3.0) Added 2024 season to all records.
- (From 1.3.0) Where available, you now have the ability to filter by median **included**, **excluded**, or **season default**.
- (From 1.3.0) Manager records are now filterable by season.
    `,
  },
  {
    version: "1.3.0",
    date: new Date(2025, 7, 3),
    title: "Add 2024 season",
    description: `
**Records**
- Added 2024 season to all records.
- Where available, you now have the ability to filter by median **included**, **excluded**, or **season default**.
- Manager records are now filterable by season.
    `,
  },
  {
    version: "1.2.0",
    date: new Date(2024, 7, 31),
    title: "Separation of playoffs & toilet bowl",
    description: `
**Records**
- Where available, you now have the ability to filter by **all**, **postseason only**, **regular season**, **playoffs**, and **toilet bowl** instead of lumping playoffs and toilet bowl together.
    `,
  },
  {
    version: "1.1.0",
    date: new Date(2024, 7, 31),
    title: "Average points for & against",
    description: `
**Records**
- **Career Standings**: number of years in league now available
- **Career Scores**: average points for & points against now available
    `,
  },
  {
    version: "1.0.0",
    date: new Date(2024, 7, 30),
    title: "Initial release",
    description: "Initial release of RFP website, debuted at live draft.",
  },
];
