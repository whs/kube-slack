import * as EventEmitter from 'events';
import * as config from 'config';
import kube from '../kube';
import {
	KubernetesTriStateBoolean,
	KubernetesPod,
	KubernetesPodCondition,
	NotifyMessage,
} from '../types';

class PodLongNotReady extends EventEmitter {
	minimumTime: number;
	alerted: { [key: string]: KubernetesPod };

	constructor() {
		super();
		this.minimumTime = parseInt(config.get('not_ready_min_time'), 10);
		this.alerted = {};
	}

	start() {
		setInterval(() => {
			this.check();
		}, parseInt(config.get('interval'), 10));

		// run an initial check right after the start instead of waiting for first interval to kick in.
		this.check();

		return this;
	}

	async check() {
		let pods = await kube.getWatchedPods();

		for (let pod of pods) {
			let messageProps: Partial<NotifyMessage> = {};
			let annotations = pod.metadata.annotations;
			if (annotations) {
				// Ignore pod if the annotation is set and evaluates to true
				if (annotations['kube-slack/ignore-pod']) {
					continue;
				}

				if (annotations['kube-slack/slack-channel']) {
					messageProps.channel = annotations['kube-slack/slack-channel'];
				}

				if (annotations['kube-slack/slack-username']) {
					messageProps.username = annotations['kube-slack/slack-username'];
				}
			}

			if (!pod.status || !pod.status.conditions) {
				continue;
			}

			let podScheduled = pod.status.conditions.filter(
				item => item.type === 'PodScheduled'
			).filter(
				item => item.reason === 'Unschedulable'
			);

			if(podScheduled.length === 0){
				continue;
			}

			let readyStatus = podScheduled[0];

			if (readyStatus.status === KubernetesTriStateBoolean.true) {
				this.checkRecovery(pod, readyStatus, messageProps);
				continue;
			}

			if (readyStatus.reason === 'PodCompleted') {
				this.checkRecovery(pod, readyStatus, messageProps);
				continue;
			}

			let notReadySince = new Date(<string>(
				readyStatus.lastTransitionTime
			)).getTime();
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

			messageProps._key = key;

			this.emit('message', {
				fallback: `Pod ${pod.metadata.namespace}/${
					pod.metadata.name
				} is not ready: ${readyStatus.reason} - ${readyStatus.message}`,
				color: 'danger',
				title: `${pod.metadata.namespace}/${
					pod.metadata.name
				}: ${readyStatus.reason || 'Pod not ready'}`,
				text: readyStatus.message || 'Pod not ready',
				...messageProps,
			} as NotifyMessage);
			this.alerted[`${pod.metadata.namespace}/${pod.metadata.name}`] = pod;
		}
	}

	checkRecovery(
		item: KubernetesPod,
		readyStatus: KubernetesPodCondition,
		messageProps: Partial<NotifyMessage>
	) {
		if (
			this.alerted[`${item.metadata.namespace}/${item.metadata.name}`] &&
			config.get('recovery_alert')
		) {
			delete this.alerted[`${item.metadata.namespace}/${item.metadata.name}`];
			this.emit('message', {
				fallback: `Pod ${item.metadata.namespace}/${
					item.metadata.name
				} is ready: ${readyStatus.reason} - ${readyStatus.message}`,
				color: 'good',
				title: `${item.metadata.namespace}/${
					item.metadata.name
				}: ${readyStatus.reason || 'Pod is ready'}`,
				text: readyStatus.message || 'Pod is ready',
				...messageProps,
				_key: messageProps._key + 'recovery',
			} as NotifyMessage);
		}
	}
}

export default () => new PodLongNotReady().start();
