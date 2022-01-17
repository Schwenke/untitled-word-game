import { Component } from '@angular/core';
import { BoardState } from './models/board-state.interface';
import { BoardStateService } from './services/board-state.service';
import { DictionaryService } from './services/dictionary.service';
import { SessionService } from './services/session.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {

  initialized: boolean = false;
  boardState: BoardState;

  constructor(
    private dictionaryService: DictionaryService,
    private sessionService: SessionService,
    private boardStateService: BoardStateService
  ) {

  }

  ngOnInit(): void {
    this.dictionaryService.initialized.subscribe(dictionaryReady => {
      if (!dictionaryReady) return;

      this.sessionService.session.subscribe(session => {
        if (!session) return;
        if (this.initialized) return;

        this.initialized = true;

        this.boardStateService.reset();
      })
    });

    this.boardStateService.boardState.subscribe(boardState => {
      if (!boardState) return;

      this.boardState = boardState;
    })
  }

  // Ensure the user doesn't accidentally toggle the side nav after clicking options and then hitting ENTER to submit a guess
  buttonKeyDown(event: KeyboardEvent) {
    event.preventDefault();
  }
}
