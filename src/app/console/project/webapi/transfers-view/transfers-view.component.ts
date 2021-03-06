import { Component, OnInit, Input } from '@angular/core';
import { TurtleApp, Transfer } from 'shared/types';
import { Observable, BehaviorSubject, combineLatest } from 'rxjs';
import { ConsoleService } from 'src/app/providers/console.service';
import { DialogService } from 'src/app/providers/dialog.service';
import { tap, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-transfers-view',
  templateUrl: './transfers-view.component.html',
  styleUrls: ['./transfers-view.component.scss']
})
export class TransfersViewComponent implements OnInit {

  readonly limitIncrement = 20;
  readonly maxLimit       = 200;

  _app: TurtleApp | undefined;
  displayedColumns: string[] = ['transferId', 'createdDate', 'amount', 'recipients'];
  transfers$: Observable<Transfer[] | undefined> | undefined;

  transferFilter$ = new BehaviorSubject<string>('');
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

      this.transfers$ = combineLatest(
        this.transferFilter$,
        this.limit$
      ).pipe(
        tap(_ => this.fetching = true),
        switchMap(([transferId, limit]) => this.consoleService.getAppTransfers$(app.appId, limit, transferId))
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
    private consoleService: ConsoleService
  ) { }

  ngOnInit() {
  }

  onSearchValueChanged(searchValue: string) {
    if (searchValue === undefined || searchValue === '') {
      this.transferFilter$.next(searchValue);
    }
  }

  onSearchValueSubmitted(searchValue: string) {
    this.transferFilter$.next(searchValue);
  }

  getTotalAmount(transfer: Transfer): number {
    return transfer.recipients.reduce((prev, cur) => prev + cur.amount, 0);
  }

  onDetailsClick(transferId: string) {
    if (!this.app) {
      console.error(`no app input defined!`);
      return;
    }

    this.dialogService.openTransferDetailsDialog(transferId, this.app.appId);
  }
}
