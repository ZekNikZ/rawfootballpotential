/* eslint-disable no-param-reassign */
import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import { CachedData, NFLData } from '../types';

export const nflSlice = createSlice({
  name: 'nfl',
  initialState: {
    lastUpdate: null,
    data: null,
  } as CachedData<NFLData>,
  reducers: {
    setNFLData: (state, action: PayloadAction<NFLData>) => {
      state.data = action.payload;
      state.lastUpdate = Date.now();
    },
  },
});

// Action creators are generated for each case reducer function
export const { setNFLData } = nflSlice.actions;

export default nflSlice.reducer;
