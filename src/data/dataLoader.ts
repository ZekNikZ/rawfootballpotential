import { Dispatch, UnknownAction } from '@reduxjs/toolkit';
import { setLoading } from './loadingSlice';
import { setNFLData } from './nfl/nflSlice';
import { loadNFLData } from './nfl/nflLoader';
import leagues from '../leaguesData';
import { loadLeague } from './leagues/leagueLoader';
import { setLeagueData } from './leagues/leagueSlice';
import { League } from './types';

export default async function loader(
  dispatch: Dispatch<UnknownAction>,
  lastNFLUpdate: number | null = null,
  lastLeagueUpdate: number | null = null
) {
  // Check to see if there are player data updates
  if (!lastNFLUpdate || lastNFLUpdate < Date.now() - 10 * 60 * 60 * 1000) {
    dispatch(setLoading('NFL data'));

    const nflData = await loadNFLData();
    dispatch(setNFLData(nflData));
  }

  // Check to see if there are league data updates
  if (!lastLeagueUpdate || lastLeagueUpdate < Date.now() - 15 * 60 * 1000) {
    dispatch(setLoading('league data'));

    // Load league data
    const leaguesData: League[] = await Promise.all(
      leagues.map(async (league) => loadLeague(league.id, (status) => dispatch(setLoading(status))))
    );

    dispatch(setLeagueData(leaguesData));
  }

  dispatch(setLoading(null));
}
