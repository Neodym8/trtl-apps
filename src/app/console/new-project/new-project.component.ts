import { Component, OnInit } from '@angular/core';
import { ConsoleService } from 'src/app/providers/console.service';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import * as Utils from '../../../../shared/utils';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-new-project',
  templateUrl: './new-project.component.html',
  styleUrls: ['./new-project.component.scss']
})
export class NewProjectComponent implements OnInit {

  termsForm: FormGroup;
  termsAgreed = false;

  form: FormGroup;
  creatingApp = false;
  errorMessage: string | undefined;
  inviteOnly: boolean;

  constructor(
    private consoleService: ConsoleService,
    private router: Router,
    private snackbar: MatSnackBar) {

    this.inviteOnly = environment.inviteOnly;

    this.termsForm = new FormGroup({
      term1: new FormControl(false, Validators.required),
      term2: new FormControl(false, Validators.required),
      term3: new FormControl(false, Validators.required)
    });

    this.form = new FormGroup({
      appName: new FormControl('', Validators.compose([
        Validators.required,
        validateName
      ])),
      inviteCode: new FormControl()
    });
  }

  ngOnInit() {
  }

  onAgree() {
    this.termsAgreed = true;
  }

  onSubmit(data: any) {
    this.errorMessage = undefined;
    this.creatingApp = true;

    this.consoleService.createApp(data.appName, data.inviteCode).then(response => {
      if (response.error) {
        this.errorMessage = response.message;
        this.snackbar.open('error creating app, please try again later.', undefined, { duration: 6000 });
      } else {
        this.router.navigateByUrl(`app/${response.appId}/overview`);
      }
    }).catch(error => {
      this.snackbar.open('error creating app, please try again later.', undefined, { duration: 6000 });
    }).finally(() => this.creatingApp = false);
  }
}

function validateName(c: FormControl) {
  return Utils.validateAppName(c.value) ? null : {
    validateName: {
      valid: false
    }
  };
}
