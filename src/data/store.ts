import { configureStore } from '@reduxjs/toolkit';

import leagueReducer from './leagues/leagueSlice';
import loadingReducer from './loadingSlice';
import nflReducer from './nfl/nflSlice';

const store = configureStore({
  reducer: {
    league: leagueReducer,
    loading: loadingReducer,
    nfl: nflReducer,
  },
});
export default store;

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;
