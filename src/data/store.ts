import { configureStore } from '@reduxjs/toolkit';

import leagueReducer from './league/leagueSlice';

export default configureStore({
  reducer: {
    league: leagueReducer,
  },
});
