const EventEmitter = require('events');
const config = require('config');
const kube = require('../kube');

class PodLongNotReady extends EventEmitter {
	constructor() {
		super();
		this.minimumTime = config.get('not_ready_min_time');
		this.clusterName = config.get('cluster_name');
	}

	start() {
		setInterval(() => {
			this.check();
		}, config.get('interval'));

		return this;
	}

	async check() {
		let pods = await kube.getPods();

		for (let pod of pods) {
			let messageProps = {};
			let annotations = pod.metadata.annotations;
			if (annotations) {
				// Ignore pod if the annotation is set and evaluates to true
				if (annotations['kube-slack/ignore-pod']) {
					continue;
				}

				if (annotations['kube-slack/slack-channel']) {
					messageProps['channel'] = annotations['kube-slack/slack-channel'];
				}
			}

			if (!pod.status || !pod.status.conditions) {
				continue;
			}

			let readyStatus = pod.status.conditions.filter(
				item => item.type === 'Ready'
			);

			if (readyStatus.length === 0) {
				continue;
			}

			readyStatus = readyStatus[0];

			if (readyStatus.status === 'True') {
				continue;
			}

			if (readyStatus.reason === 'PodCompleted') {
				continue;
			}

			let notReadySince = new Date(readyStatus.lastTransitionTime).getTime();
			let notReadyDuration = new Date().getTime() - notReadySince;

			if (notReadyDuration < this.minimumTime) {
				continue;
			}

			let key = pod.metadata.name;

			if (
				pod.metadata.ownerReferences &&
				pod.metadata.ownerReferences.length > 0
			) {
				key = pod.metadata.ownerReferences[0].name;
			}

			const clusterInfo = this.clusterName ? ` in ${this.clusterName}` : '';
			const podTitle = `${pod.metadata.namespace}/${
				pod.metadata.name
			}${clusterInfo}`;

			this.emit('message', {
				fallback: `Pod ${podTitle} is not ready: ${readyStatus.reason} - ${
					readyStatus.message
				}`,
				color: 'danger',
				title: `${podTitle}: ${readyStatus.reason || 'Pod not ready'}`,
				text: readyStatus.message || 'Pod not ready',
				_key: key,
				...messageProps,
			});
		}
	}
}

module.exports = () => new PodLongNotReady().start();
