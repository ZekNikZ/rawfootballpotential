import axios from 'axios';

export const sleeperApi = axios.create({
  baseURL: 'https://api.sleeper.app/v1/',
});
