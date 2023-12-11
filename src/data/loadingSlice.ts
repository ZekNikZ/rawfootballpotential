/* eslint-disable no-param-reassign */
import { PayloadAction, createSlice } from '@reduxjs/toolkit';

export const loadingSlice = createSlice({
  name: 'loading',
  initialState: {
    loading: false,
    loadingData: null,
    loadingNotificationId: null,
  } as { loading: boolean; loadingData: string | null; loadingNotificationId: string | null },
  reducers: {
    setLoading: (state, action: PayloadAction<string | null>) => {
      if (action.payload) {
        state.loading = true;
        state.loadingData = action.payload;
      } else {
        state.loading = false;
        state.loadingData = null;
      }
    },
    setLoadingNotificationId: (state, action: PayloadAction<string | null>) => {
      state.loadingNotificationId = action.payload;
    },
  },
});

// Action creators are generated for each case reducer function
export const { setLoading, setLoadingNotificationId } = loadingSlice.actions;

export default loadingSlice.reducer;
