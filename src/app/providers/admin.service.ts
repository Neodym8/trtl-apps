import { Injectable } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/functions';
import { Withdrawal, Deposit, Account, DaemonErrorEvent, WalletStatus, ServiceUser, UserRole, TurtleApp } from 'shared/types';
import { AngularFirestore } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ServiceConfig, ServiceNode, SavedWallet, AppAuditResult, AppInviteCode, ServiceNodeUpdate } from 'functions/src/types';

@Injectable({
  providedIn: 'root'
})
export class AdminService {

  constructor(
    private firestore: AngularFirestore,
    private afFunctions: AngularFireFunctions) { }

  async getWalletStatus(): Promise<WalletStatus[] | undefined> {
    try {
      const response = await this.afFunctions.httpsCallable('serviceAdmin-getWalletStatus')({ }).toPromise();
      return response as WalletStatus[];
    } catch (error) {
      console.log(error);
      return undefined;
    }
  }

  async rewindServiceWallet(checkpoint: string): Promise<number> {
    const response = await this.afFunctions.httpsCallable('serviceAdmin-rewindWallet')({
      checkpoint
    }).toPromise();

    return response.walletHeight;
  }

  async getDepositHistory(depositId: string): Promise<Deposit[] | undefined> {
    try {
      const response = await this.afFunctions.httpsCallable('serviceAdmin-getDepositHistory')({
        depositId
      }).toPromise();

      return response as Deposit[];
    } catch (error) {
      return undefined;
    }
  }

  async getWithdrawalHistory(withdrawalId: string): Promise<Withdrawal[] | undefined> {
    try {
      const response = await this.afFunctions.httpsCallable('serviceAdmin-getWithdrawalHistory')({
        withdrawalId
      }).toPromise();

      return response as Withdrawal[];
    } catch (error) {
      return undefined;
    }
  }

  async getServiceChargeAccounts(): Promise<Account[] | undefined> {
    try {
      const response = await this.afFunctions.httpsCallable('serviceAdmin-getServiceChargeAccounts')({}).toPromise();

      return response as Account[];
    } catch (error) {
      console.log(error);
      return undefined;
    }
  }

  async assignUserRole(uid: string | undefined, email: string | undefined, role: UserRole): Promise<void> {
    await this.afFunctions.httpsCallable('serviceAdmin-assignUserRole')({
      uid,
      email,
      role
    }).toPromise();
  }

  async removeUserRole(uid: string, role: UserRole): Promise<void> {
    await this.afFunctions.httpsCallable('serviceAdmin-removeUserRole')({
      uid,
      role
    }).toPromise();
  }

  async getApp(appId: string): Promise<TurtleApp | undefined> {
    const snapshot = await this.firestore.doc<TurtleApp>(`apps/${appId}`).get().toPromise();

    if (!snapshot.exists) {
      return undefined;
    }

    return snapshot.data() as TurtleApp;
  }

  async generateServiceInvitations(amount: number = 5): Promise<void> {
    await this.afFunctions.httpsCallable('serviceAdmin-createInvitationsBatch')({
      amount
    }).toPromise();
  }

  getServiceInvitations$(limit: number = 15): Observable<AppInviteCode[]> {
    return this.firestore
      .collection<AppInviteCode>('appInvites', ref => ref
        .where('claimed', '==', false)
        .limit(limit)
        .orderBy('createdAt', 'asc'))
      .valueChanges();
  }

  getAppAudits(appId: string, limit: number = 30): Promise<AppAuditResult[]> {
    return this.firestore
      .collection<AppAuditResult>('appAudits', ref => ref
        .where('appId', '==', appId)
        .orderBy('timestamp', 'desc')
        .limit(limit))
      .get()
      .pipe(map(s => s.docs.map(d => d.data() as AppAuditResult)))
      .toPromise();
  }

  getAppAudit$(auditId: string): Observable<AppAuditResult | undefined> {
    return this.firestore.doc<AppAuditResult>(`appAudits/${auditId}`).valueChanges();
  }

  getWalletSavesHistory$(limit: number): Observable<SavedWallet[]> {
    return this.firestore
      .collection<SavedWallet>('wallets/master/saves', ref => ref
        .where('hasFile', '==', true)
        .orderBy('timestamp', 'desc')
        .limit(limit))
      .valueChanges();
  }

  getServiceConfig$(): Observable<ServiceConfig | undefined> {
    return this.firestore.doc<ServiceConfig>('globals/config').valueChanges();
  }

  getUsersByRole$(role: UserRole, limit: number = 50): Observable<ServiceUser[]> {
    return this.firestore
      .collection<ServiceUser>('serviceUsers', ref => ref
        .where('roles', 'array-contains', role)
        .limit(limit))
      .valueChanges();
  }

  getServiceNodes$(): Observable<ServiceNode[]> {
    return this.firestore
      .collection<ServiceNode>('nodes', ref => ref.orderBy('priority', 'desc'))
      .valueChanges();
  }

  async addServiceNode(url: string, port: number, priority: number): Promise<void> {
    const id = this.firestore.createId();

    const node: ServiceNode = {
      id,
      name: `[fetching node info...] ${url}:${port}`,
      url,
      port,
      priority,
      ssl: false,
      cache: false,
      fee: 0,
      availability: 0,
      online: false,
      version: '0.0.0',
      lastUpdateAt: Date.now(),
      lastDropAt: 0
    };

    await this.firestore.doc<ServiceNode>(`nodes/${id}`).set(node);
  }

  async updateServiceNode(nodeId: string, update: ServiceNodeUpdate): Promise<void> {
    await this.firestore.doc<ServiceNode>(`nodes/${nodeId}`).update(update);
  }

  async removeNode(nodeId: string): Promise<void> {
    await this.firestore.doc<ServiceNode>(`nodes/${nodeId}`).delete();
  }

  getDaemonErrors$(): Observable<DaemonErrorEvent[]> {
    return this.firestore.
      collection<DaemonErrorEvent>('admin/reports/daemonErrors', ref =>
        ref.orderBy('timestamp', 'desc')
        .limit(50))
      .valueChanges();
  }
}
