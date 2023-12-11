/* eslint-disable no-param-reassign */
import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import { CachedData, League, LeagueId } from '../types';
import leagues from '../../leaguesData';

export const leagueSlice = createSlice({
  name: 'league',
  initialState: {
    lastUpdate: null,
    data: null,
  } as CachedData<{ leagues: Record<LeagueId, League>; currentLeague: LeagueId }>,
  reducers: {
    setLeagueData: (state, action: PayloadAction<League[]>) => {
      state.data = {
        leagues: Object.fromEntries(action.payload.map((l) => [l.leagueId, l])),
        currentLeague: state.data?.currentLeague ?? leagues[0].id,
      };
    },
    setCurrentLeague: (state, action: PayloadAction<LeagueId>) => {
      if (state.data) state.data!.currentLeague = action.payload;
    },
  },
});

// Action creators are generated for each case reducer function
export const { setLeagueData, setCurrentLeague } = leagueSlice.actions;

export default leagueSlice.reducer;
