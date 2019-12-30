import * as admin from 'firebase-admin';
import * as WalletManager from './walletManager';
import * as axios from 'axios';
import { ServiceConfig, ServiceNode, ServiceNodeUpdate, NodeStatus, ServiceConfigUpdate, AppInviteCode } from './types';
import { sleep } from './utils';
import { WalletError } from 'turtlecoin-wallet-backend';
import { SubWalletInfo } from '../../shared/types';
import { minUnclaimedSubWallets, availableNodesEndpoint } from './constants';
import { ServiceError } from './serviceError';

export async function boostrapService(): Promise<[string | undefined, undefined | ServiceError]> {
  const masterWalletInfo = await WalletManager.getMasterWalletInfo();

  if (masterWalletInfo !== undefined) {
    return [undefined, new ServiceError('service/master-wallet-info', 'Service already bootstrapped!')];
  }

  const serviceConfig: ServiceConfig = {
    daemonHost:             'blockapi.turtlepay.io',  // Default daemon to connect to
    daemonPort:             443,                      // Port number of the daemon
    nodeFee:                10,                       // Fee to use when sending transaction to the node
    txScanDepth:            2 * 60 * 24 * 7,          // Scan transactions up to aprox 7 days in the past
    txConfirmations:        6,                        // Amount of blocks needed to confirm a deposit/withdrawal
    withdrawTimoutBlocks:   20,                       // Amount of blocks since a withdrawal tx was lost before it is considered failed
    waitForSyncTimeout:     20000,                    // Max time is miliseconds for the master wallet to sync
    serviceHalted:          false,                    // If true, the service is disables and doesn't process transactions
    inviteOnly:             true                      // An invitation code is required to create an app
  }

  const nodes: ServiceNode[] = [
  {
    id: 'node1',
    name: 'TurtlePay Blockchain Cache - SSL',
    url: 'blockapi.turtlepay.io',
    port: 443,
    ssl: true,
    cache: true,
    fee: 0,
    availability: 0,
    online: false,
    version:'',
    priority: 100,
    lastUpdateAt: 0,
    lastDropAt: 0
  },
  {
    id: 'node2',
    name: 'TurtlePay Blockchain Cache',
    url: 'node.trtlpay.com',
    port: 80,
    ssl: false,
    cache: true,
    fee: 0,
    availability: 0,
    online: false,
    version:'',
    priority: 99,
    lastUpdateAt: 0,
    lastDropAt: 0
  },
  {
    id: 'node3',
    name: 'Bot.Tips Blockchain Cache',
    url: 'trtl.bot.tips',
    port: 80,
    ssl: false,
    cache: true,
    fee: 0,
    availability: 0,
    online: false,
    version:'',
    priority: 98,
    lastUpdateAt: 0,
    lastDropAt: 0
  }];

  const batch = admin.firestore().batch();

  nodes.forEach(node => {
    const docRef = admin.firestore().collection('nodes').doc();
    batch.set(docRef, node);
  });

  await batch.commit();
  await admin.firestore().doc('globals/config').set(serviceConfig);

  console.log('service config created! creating master wallet...');

  return await WalletManager.createMasterWallet(serviceConfig);
}

export async function getServiceConfig(): Promise<[ServiceConfig | undefined, undefined | ServiceError]> {
  const configDoc = await admin.firestore().doc('globals/config').get();

  if (!configDoc.exists) {
    return [undefined, new ServiceError('service/not-initialized')];
  }

  const config = configDoc.data() as ServiceConfig;
  return [config, undefined];
}

export async function validateInviteCode(code: string): Promise<boolean> {
  const snapshot = await admin.firestore().doc(`appInvites/${code}`).get();

  if (!snapshot.exists) {
    return false;
  }

  const invite = snapshot.data() as AppInviteCode;

  return !invite.claimed;
}

export async function updateMasterWallet(): Promise<void> {
  console.log(`master wallet sync job started at: ${Date.now()}`);

  const [serviceConfig, serviceConfigError] = await getServiceConfig();

  if (!serviceConfig) {
    console.error((serviceConfigError as ServiceError).message);
    return;
  }

  const [wallet, walletError] = await WalletManager.getMasterWallet(serviceConfig, true);

  if (!wallet) {
    console.error((walletError as ServiceError).message);
    return;
  }

  const masterWalletInfoAtStart = await WalletManager.getMasterWalletInfo();

  if (!masterWalletInfoAtStart) {
    console.log('failed to get master wallet info at sync start!');
    return;
  }

  const lastSaveAtStart = masterWalletInfoAtStart.lastSaveAt;
  const syncInfoStart   = WalletManager.getWalletSyncInfo(wallet);
  const balanceStart    = wallet.getBalance();

  console.log(`sync info at start: ${JSON.stringify(syncInfoStart)}`);
  console.log(`total balance at start: ${JSON.stringify(balanceStart)}`);

  const syncSeconds = syncInfoStart.heightDelta < 60 ? 30 : 240;

  console.log(`run sync job for ${syncSeconds}s ...`);
  await sleep(syncSeconds * 1000);

  const masterWalletInfoAtEnd = await WalletManager.getMasterWalletInfo();

  if (!masterWalletInfoAtEnd) {
    console.log('failed to get master wallet info at sync end!');
    return;
  }

  const lastSaveAtEnd = masterWalletInfoAtEnd.lastSaveAt;

  if (lastSaveAtEnd !== lastSaveAtStart) {
    console.log(`wallet has been saved during sync! skipping master wallet update save.`);
    return;
  }

  const syncInfoEnd     = WalletManager.getWalletSyncInfo(wallet);
  const processedCount  = syncInfoEnd.walletHeight - syncInfoStart.walletHeight;
  const balanceEnd      = wallet.getBalance();

  console.log(`blocks processed: ${processedCount}`);
  console.log(`sync info at end: ${JSON.stringify(syncInfoEnd)}`);
  console.log(`total balance at end: ${JSON.stringify(balanceEnd)}`);

  // check if we should create more subWallets
  const unclaimedSubWallets = await WalletManager.getSubWalletInfos(true);

  console.log(`unclaimed subWallets count: ${unclaimedSubWallets.length}`);
  const newSubWallets: string[] = [];

  if (unclaimedSubWallets.length < minUnclaimedSubWallets) {
    for (let i = 0; i < minUnclaimedSubWallets; i++) {
      const [address, error] = wallet.addSubWallet();

      if (!address) {
        console.error((error as WalletError));
      } else {
        console.log(`created new subWallet: ${address}`);
        newSubWallets.push(address);
      }
    }
  }

  if (syncInfoEnd.heightDelta <= 2) {
    const optimizeStartAt = Date.now();
    const [numberOfTransactionsSent, ] = await wallet.optimize();
    const optimizeEndAt = Date.now();
    const optimizeSeconds = (optimizeEndAt - optimizeStartAt) * 0.001;

    console.log(`optimize took: [${optimizeSeconds}]s, # txs sent: [${numberOfTransactionsSent}]`);
  }

  const [, saveError] = await WalletManager.saveMasterWallet(wallet);

  if (saveError) {
    console.error(saveError.message);
    return;
  }

  if (newSubWallets.length > 0) {
    const batch = admin.firestore().batch();
    let newSubWalletCount = 0;

    newSubWallets.forEach(address => {
      const [publicSpendKey, privateSpendKey, err] = wallet.getSpendKeys(address);

      if (!publicSpendKey || !privateSpendKey || err) {
        console.error(err);
      } else {
        const doc = admin.firestore().collection('wallets/master/subWallets').doc();

        const subWalletInfo: SubWalletInfo = {
          id: doc.id,
          address: address,
          claimed: false,
          publicSpendKey: publicSpendKey,
          privateSpendKey: privateSpendKey
        }

        batch.create(doc, subWalletInfo);
        newSubWalletCount++;
      }
    });

    try {
      await batch.commit();
      console.log(`successfully added ${newSubWalletCount} new unclaimed subWallets.`);
    } catch (error) {
      console.error(`error while adding new subWallets: ${error}`);
    }
  }
}

export async function dropCurrentNode(currentNodeUrl: string): Promise<void> {
  console.log(`dropping current service node: ${currentNodeUrl}`);

  const [serviceConfig, configError] = await getServiceConfig();

  if (!serviceConfig) {
    console.log((configError as ServiceError).message);
    return;
  }

  if (serviceConfig.daemonHost !== currentNodeUrl) {
    console.log(`current service node already changed, skipping drop node.`);
    return;
  }

  const currentNode = await getServiceNodeByUrl(currentNodeUrl);

  if (!currentNode) {
    console.log(`unable to find service node by url: [${currentNodeUrl}], skipping drop node.`);
    return;
  }

  const nodesSnaphot = await admin.firestore()
                        .collection('nodes')
                        .where('online', '==', true)
                        .orderBy('priority', 'desc')
                        .get();

  if (nodesSnaphot.size === 0) {
    return;
  }

  const nodes = nodesSnaphot.docs.map(d => d.data() as ServiceNode);
  const now = Date.now();

  // only consider nodes that have not dropped in the last 30 minutes
  const candidateNodes = nodes.filter(n => ((n.lastDropAt + 30 * 60 * 1000) < now) && n.url !== currentNodeUrl);

  if (candidateNodes.length === 0) {
    console.log('no candidate nodes available, skipping drop node.');
    return;
  }

  const newNode = candidateNodes[0];

  const configUpdate: ServiceConfigUpdate = {
    daemonHost: newNode.url,
    daemonPort: newNode.port
  }

  const droppedNodeUpdate: ServiceNodeUpdate = {
    lastUpdateAt: now,
    lastDropAt: now
  }

  const configPromise = admin.firestore().doc(`globals/config`).update(configUpdate);
  const nodePromise   = admin.firestore().doc(`nodes/${currentNode.id}`).update(droppedNodeUpdate);

  try {
    await Promise.all([configPromise, nodePromise]);

    console.log(`node: ${currentNodeUrl} dropped, new node: ${newNode.url}`);
  } catch (error) {
    console.log(error);
  }
}

export async function checkNodeSwap(): Promise<void> {
  const nodesSnaphot = await admin.firestore()
                        .collection('nodes')
                        .where('online', '==', true)
                        .orderBy('priority', 'desc')
                        .get();

  const nodes = nodesSnaphot.docs.map(d => d.data() as ServiceNode);
  const now = Date.now();

  // only consider nodes that have not dropped in the last 60 minutes
  const candidateNodes = nodes.filter(n => (n.lastDropAt + 60 * 60 * 1000) < now);

  if (candidateNodes.length === 0) {
    return;
  }

  const recommendedNode = candidateNodes[0];
  const [serviceConfig, configError] = await getServiceConfig();

  if (!serviceConfig) {
    console.log((configError as ServiceError).message);
    return;
  }

  const currentNodeUrl = serviceConfig.daemonHost;

  if (currentNodeUrl !== recommendedNode.url) {
    console.log(`changing service node from ${currentNodeUrl} to: ${recommendedNode.url}`);

    const updateObject: ServiceConfigUpdate = {
      daemonHost: recommendedNode.url,
      daemonPort: recommendedNode.port
    }

    await admin.firestore().doc(`globals/config`).update(updateObject);
  }
}

export async function updateServiceNodes(): Promise<void> {
  try {
    const serviceNodesSnapshot    = await admin.firestore().collection('nodes').get();
    const availableNodesResponse  = await axios.default.get(availableNodesEndpoint);

    const serviceNodes = serviceNodesSnapshot.docs.map(d => d.data() as ServiceNode);
    const nodeStatuses = availableNodesResponse.data.nodes as NodeStatus[];

    if (serviceNodes.length === 0 || nodeStatuses.length === 0) {
      return;
    }

    console.log(`service nodes: #${serviceNodesSnapshot.size}, available nodes: #${nodeStatuses.length}`);

    await doServiceNodeUpdates(serviceNodes, nodeStatuses);

  } catch (error) {
    console.error(error);
  }
}

async function getServiceNodeByUrl(url: string): Promise<ServiceNode | undefined> {
  const snapshot = await admin.firestore().collection('nodes').where('url', '==', url).get();

  if (snapshot.size !== 1) {
    return undefined;
  }

  return snapshot.docs[0].data() as ServiceNode;
}

function doServiceNodeUpdates(serviceNodes: ServiceNode[], nodeStatuses: NodeStatus[]): Promise<any> {
  const now   = Date.now();
  const batch = admin.firestore().batch();

  serviceNodes.forEach(serviceNode => {
    const docRef = admin.firestore().doc(`nodes/${serviceNode.id}`);
    const status = nodeStatuses.find(s => s.url === serviceNode.url);

    const updateObject: ServiceNodeUpdate = {
      lastUpdateAt: now,
    };

    if (status) {
      updateObject.lastUpdateAt = status.timestamp;
      updateObject.cache        = status.cache;
      updateObject.fee          = status.fee.amount;
      updateObject.availability = status.availability;
      updateObject.name         = status.name;
      updateObject.online       = status.online;
      updateObject.ssl          = status.ssl;
      updateObject.version      = status.version;
    } else {
      updateObject.availability = 0;
      updateObject.online       = false;
    }

    batch.update(docRef, updateObject);
  });

  return batch.commit();
}
