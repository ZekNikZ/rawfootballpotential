interface ChangelogEntry {
  version: string;
  date: Date;
  title: string;
  description: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.1.0",
    date: new Date(2024, 7, 31),
    title: "Separation of playoffs & toilet bowl",
    description: `
**Records**
- Where available, you now have the ability to filter by **all**, **postseason only**, **regular season**, **playoffs**, and **toilet bowl** instead of lumping playoffs and toilet bowl together.
    `,
  },
  {
    version: "1.0.0",
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
