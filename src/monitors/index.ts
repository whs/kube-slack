import { MonitorFactory } from '../types';

export default [
	require('./waitingpods').default,
	require('./longnotready').default,
	require('./metrics').default,
	require('./pendingpods').default,
] as MonitorFactory[];
