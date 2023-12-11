import '@mantine/core/styles.css';

import { MantineProvider } from '@mantine/core';
import { Provider } from 'react-redux';
import { Notifications } from '@mantine/notifications';
import { Router } from './pages/utils/Router';
import { theme } from './utils/theme';
import store from './data/store';

export default function App() {
  return (
    <Provider store={store}>
      <MantineProvider theme={{ ...theme, primaryColor: 'blue' }} defaultColorScheme="auto">
        <Notifications zIndex={2000} />
        <Router />
      </MantineProvider>
    </Provider>
  );
}
