import { combineReducers, configureStore } from '@reduxjs/toolkit';

import leagueReducer from './leagues/leagueSlice';
import loadingReducer from './loadingSlice';
import nflReducer from './nfl/nflSlice';

const reducer = combineReducers({
  league: leagueReducer,
  loading: loadingReducer,
  nfl: nflReducer,
});

const store = configureStore({
  reducer,
  preloadedState: localStorage.getItem('reduxState')
    ? JSON.parse(localStorage.getItem('reduxState')!)
    : {
        league: { lastUpdate: null, data: null },
        loading: {
          loading: false,
          loadingData: null,
          loadingNotificationId: null,
        },
        nfl: {
          lastUpdate: null,
          data: null,
        },
      },
});
export default store;

store.subscribe(() => {
  localStorage.setItem('reduxState', JSON.stringify(store.getState()));
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;
