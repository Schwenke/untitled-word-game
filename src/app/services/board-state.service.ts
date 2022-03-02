import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MaxGuesses } from '../constants';
import { BoardState, Letter, Word } from '../models/board-state.interface';
import { Session } from '../models/session.interface';
import { DictionaryService } from './dictionary.service';
import { KeyboardService } from './keyboard.service';
import { SessionService } from './session.service';
import { TimerService } from './timer.service';

@Injectable({
  providedIn: 'root'
})

/**
 * Ye old meat and potatoes
 * Bulk of the game state processing happens here
 */
export class BoardStateService {
    boardState: BehaviorSubject<BoardState> = new BehaviorSubject<BoardState>({ error: ""} as BoardState);
    session: Session;
    //  Needed so we don't save the game into session again if page is refreshed when game state is on victory or failure dialog
    loadingSession: boolean = false;

  constructor(
    private dictionaryService: DictionaryService,
    private timerService: TimerService,
    private keyboardService: KeyboardService,
    private sessionService: SessionService
  ) { 

    this.sessionService.session.subscribe(session => {
      if (!session) return;
      
      this.session = session;
    });
  }

  public initialize(): void {
    if (this.shouldLoadPreviousSession()) {
      this.loadExistingSession();
    } else {
      this.reset();
    }
  }

  public startNewGame(): void {
    this.reset();

    //  If a user starts a new game, clear out existing session secret and guesses
    this.updateSession();
  }

  private reset(): void {
    let wordLength = this.getWordLength();

    this.startSession();

    this.resetBoard(wordLength);

    this.resetTimer();
  }

  private resetBoard(wordLength: number): void {
    let boardState = this.getDefaultBoardState(wordLength);

    this.keyboardService.initialize();

    this.boardState.next(boardState);
  }

  private resetTimer(): void {
    this.timerService.reset();
    this.timerService.start();
  }

  /**
   * Generates a new secret word and places it into the session
   * Also reinitializes the session guess list
   */
  private startSession(): void {
    let wordLength = this.getWordLength();
    
    this.session.secret = this.dictionaryService.generateWord(wordLength);

    this.session.guesses = [];
  }

  private getDefaultBoardState(wordLength: number): BoardState {
    let boardState: BoardState = {} as BoardState;

    boardState.rowIndex = 0;
    boardState.columnIndex = -1;
    boardState.success = false;
    boardState.failure = false;
    boardState.error = "";
    boardState.words = [];

    for (let i = 0; i < MaxGuesses; i++) {
      let word = {} as Word;
      word.letters = [];

      boardState.words.push(word);

      for (let j = 0; j < wordLength; j++) {
        let letter = { letter: "", perfect: false, partial: false, committed: false } as Letter;
        boardState.words[i].letters.push(letter);
      }
    }

    return boardState;
  }

  private loadExistingSession(): void {
    this.loadingSession = true;

    let wordLength: number = this.session.guesses[0].length;

    this.resetBoard(wordLength);

    for (let i = 0; i < this.session.guesses.length; i++) {
      let previousGuess: string = this.session.guesses[i];

      this.updateBoardState(previousGuess);

      //  Previous game may have ended in failure or success - need to make sure we replay the dialog
      this.checkForGameEnd(previousGuess);
    }

    this.resetTimer();

    this.loadingSession = false;
  }

  private shouldLoadPreviousSession(): boolean {
    return this.session.guesses && this.session.guesses.length > 0;
  }

  public removeInput(): void {
    let boardState: BoardState = this.boardState.value;

    //  Cannot remove input - already at the first column
    if (boardState.columnIndex === -1) return;
    
    let word = this.getCurrentWord();

    word.letters[boardState.columnIndex].letter = "";

    --boardState.columnIndex;

    //  check to clear any errors, since we will be pushing the observable
    boardState.error = "";

    this.boardState.next(boardState);
  }

  public appendInput(key: string): void {
    let boardState: BoardState = this.boardState.value;

    let wordLength = this.getWordLength() - 1;

    //  Can't append any more characters - word is at max length
    if (boardState.columnIndex === wordLength) return;

    let validInput: boolean = this.keyboardService.validateInput(key);

    if (validInput) {
      ++boardState.columnIndex;

      let word = this.getCurrentWord();

      word.letters[boardState.columnIndex].letter = key.toLocaleUpperCase();

      //  check to clear any errors, since we will be pushing the observable
      boardState.error = "";

      this.boardState.next(boardState);
    }
  }

  public getCurrentWord(): Word {
    let boardState: BoardState = this.boardState.value;

    return boardState.words[boardState.rowIndex];
  }

  public getWordLength(): number {
    return +this.session.options.wordLength;
  }

  getUserGuess(): string {
    let boardState: BoardState = this.boardState.value;
    let userGuess: string = "";
    let letters = boardState.words[boardState.rowIndex].letters;

    for (let i = 0; i < letters.length; i++) {
      let letter = letters[i];

      userGuess += letter.letter;
    }

    return userGuess;
  }

  public guess(): void {
    let timeOut: number = 100;

    //  Give enough time for the pending animation to finish before attempting to commit, which can trigger another animation
    //  If the animations collide, then the flip never plays and causes some weirdness to happen with the pending

    setTimeout(() => {
      this.processGuess();
    }, timeOut);
  }

  private processGuess(): void {
    let boardState: BoardState = this.boardState.value;

    let guess = this.getUserGuess().toLocaleUpperCase();

    boardState.error = this.validate(guess);

    this.boardState.next(boardState);

    if (boardState.error.length > 0) {
      //  User input error - don't process further
      return;
    }

    this.updateBoardState(guess);

    this.session.guesses.push(guess);

    this.updateSession();

    this.checkForGameEnd(guess);
  }

  private checkForGameEnd(guess: string): void {
    if (this.checkVictory(guess)) {
      return;
    }

    this.checkFailure();
  }

  private updateBoardState(guess: string): void {
    let boardState: BoardState = this.boardState.value;
    let secret: string = this.session.secret;

    let secretWordLetters = secret.split('');
    let partialClues: string[] = [];
    let perfectClues: string[] = [];

    //  First look for perfect matches - correct letter in the correct position
    for (let i = 0; i < guess.length; i++) {
      let guessLetter = guess[i];
      let correctLetter = secret[i];
      let boardStateLetter = boardState.words[boardState.rowIndex].letters[i];
      const index = secretWordLetters.indexOf(guessLetter);

      boardStateLetter.committed = true;
      boardStateLetter.letter = guessLetter;

      if (guessLetter === correctLetter) {
        boardStateLetter.perfect = true;
        perfectClues.push(guessLetter);
        secretWordLetters.splice(index, 1);
      }
    }

    //  Next, look for partial matches - correct letter in the incorrect position
    //  The loops are done separately so we do not accidentally mark a word with multiples of the same correct clue twice - E.g. Secret word "HUMAN" and guess "AVIAN"
    //  Specifically ignore letters marked as perfect so we do not overwrite perfect status - can happen e.g. in 7 word mode when secret is FEDERAL and guess is FELLOWS
    for (let i = 0; i < guess.length; i++) {
      let guessLetter = guess[i];
      let boardStateLetter = boardState.words[boardState.rowIndex].letters[i];
      const index = secretWordLetters.indexOf(guessLetter);

      if (!boardStateLetter.perfect && index > -1) {
        partialClues.push(guessLetter);
        boardStateLetter.partial = true;
        secretWordLetters.splice(index, 1);
      }
    }

    this.keyboardService.registerKeys(guess, partialClues, perfectClues);

    //  Move to the next row
    ++boardState.rowIndex;

    //  Reset column index
    boardState.columnIndex = -1;

    this.boardState.next(boardState);
  }

  private checkFailure(): void {
    let boardState: BoardState = this.boardState.value;

    if (!boardState.success && boardState.rowIndex >= MaxGuesses) {
      boardState.failure = true;
      this.processGameEnd(boardState);
    }
  }

  private checkVictory(guess: string): boolean {
    let boardState: BoardState = this.boardState.value;

    if (guess === this.session.secret) {
      boardState.success = true;
      this.processGameEnd(boardState);
      return true;
    }

    return false;
  }

  private updateSession(): void {
    if (this.loadingSession) return;

    let boardState: BoardState = this.boardState.value;
    
    this.sessionService.update(boardState);
    this.sessionService.save();
  }

  private processGameEnd(boardState: BoardState): void {
    this.timerService.stop();
    this.updateSession();
    this.boardState.next(boardState);
  }

  private validate(guess: string): string {
    if (!guess || guess.trim() === "") {
      return "You cannot enter empty words!";
    }

    let wordLength = this.getWordLength();

    if (guess.length !== wordLength) {
      return `Words must be ${wordLength} letters long!`;
    }

    if (!this.dictionaryService.hasWord(guess)) {
      return "This isn't a real word!";
    }

    if (this.guessedPreviously(guess)) {
      return "You've already guessed this before!";
    }

    if (!this.validateHardMode(guess)) {
      return "Hard mode is enabled - you must use all previous correctly guessed letters in subsequent guesses!";
    }

    return "";
  }

  private validateHardMode(guess: string): boolean {
    //  not enabled
    if (!this.session.options.hardMode) return true;

    let correctlyGuessedLetters = this.getCorrectlyGuessedLetters();

    // no correct guesses so far
    if (correctlyGuessedLetters.length === 0) return true;

    for (let i = 0; i < correctlyGuessedLetters.length; i++) {
      let letter = correctlyGuessedLetters[i];
      let index = guess.indexOf(letter);

      if (index === -1) {
        //  the guess doesn't contain the letter
        return false;
      }
    }

    return true;
  }

  private guessedPreviously(guess: string): boolean {
    let previousGuesses: string[] = this.session.guesses;

    for (let i = 0; i < previousGuesses.length; i++) {
      let previousGuess = previousGuesses[i];

      if (guess === previousGuess) {
        return true
      }
    }

    return false;
  }

  private getCorrectlyGuessedLetters(): string[] {
    let boardState: BoardState = this.boardState.value;

    let correctGuesses: string[] = [];

    for (let i = 0; i < boardState.rowIndex; i++) {
      let row = boardState.words[i];

      for (let k = 0; k < row.letters.length; k++) {
        let letter = row.letters[k];

        if (letter.perfect || letter.partial) {
          correctGuesses.push(letter.letter);
        }
      }
    }

    return correctGuesses;
  }


}
