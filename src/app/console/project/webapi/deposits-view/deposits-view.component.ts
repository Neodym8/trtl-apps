import { Component, OnInit, Input } from '@angular/core';
import { Observable, BehaviorSubject, combineLatest } from 'rxjs';
import { ConsoleService } from 'src/app/providers/console.service';
import { DialogService } from 'src/app/providers/dialog.service';
import { tap, switchMap } from 'rxjs/operators';
import { TurtleApp, Deposit } from 'shared/types';

@Component({
  selector: 'app-deposits-view',
  templateUrl: './deposits-view.component.html',
  styleUrls: ['./deposits-view.component.scss']
})
export class DepositsViewComponent implements OnInit {

  readonly limitIncrement = 20;
  readonly maxLimit       = 200;

  _app: TurtleApp | undefined;
  displayedColumns: string[] = ['depositId', 'createdDate', 'amount', 'status'];
  deposits$: Observable<Deposit[] | undefined> | undefined;

  depositFilter$  = new BehaviorSubject<string>('');
  limit$          = new BehaviorSubject<number>(this.limitIncrement);
  fetching        = false;
  showLoadMore    = false;

  get app(): TurtleApp | undefined {
    return this._app;
  }

  @Input()
  set app(app: TurtleApp | undefined) {
    this._app = app;

    if (app) {
      this.fetching = true;

      this.deposits$ = combineLatest(
        this.depositFilter$,
        this.limit$
      ).pipe(
        tap(_ => this.fetching = true),
        switchMap(([depositId, limit]) => this.consoleService.getAppDeposits$(app.appId, limit, depositId))
      ).pipe(
        tap(deposits => {
          const limit       = this.limit$.value;
          this.fetching     = false;
          this.showLoadMore = deposits.length === limit && limit < this.maxLimit;
        })
      );
    }
  }

  constructor(
    private dialogService: DialogService,
    private consoleService: ConsoleService) { }

  ngOnInit() {
  }

  onSearchValueChanged(searchValue: string) {
    if (searchValue === undefined || searchValue === '') {
      this.depositFilter$.next(searchValue);
    }
  }

  onSearchValueSubmitted(searchValue: string) {
    this.depositFilter$.next(searchValue);
  }

  onDetailsClick(depositId: string) {
    if (!this.app) {
      console.error(`no app input defined!`);
      return;
    }

    this.dialogService.openDepositDetailsDialog(depositId, this.app.appId);
  }

  accountDetailsClick(accountId: string) {
    if (!this.app) {
      console.error(`no app input defined!`);
      return;
    }

    this.dialogService.openAccountDetailsDialog(accountId, this.app);
  }
}
