import { Component, Input, Output, EventEmitter, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { Harness } from '../../domain/harness.model';
import { Actions, ofType } from '@ngrx/effects';
import { Subscription } from 'rxjs';
import { createHarnessSuccess, createHarnessFailure, makeHarnessActiveSuccess, makeHarnessActiveFailure } from '../store/harness.actions';
@Component({
  selector: 'app-harness-list',
  standalone: true,
  imports: [],
  templateUrl: './harness-list.component.html',
  styleUrl: './harness-list.component.css',
})
export class HarnessListComponent {
  @Input() harnesses: Harness[] = [];
  @Input() selectedHarness: Harness | null = null;
  @Input() isLoading = false;

  @Output() selectHarness = new EventEmitter<Harness>();
  @Output() createHarness = new EventEmitter<{code: string, name: string, cloneFromHarnessId?: string}>();
  @Output() deleteHarness = new EventEmitter<Harness>();
  @Output() activateHarness = new EventEmitter<Harness>();

  showModal = false;
  isSaving = false;
  newCode = '';
  newName = '';
  cloneFromId = '';
  togglingHarnessId = signal<string | null>(null);

  private actions$ = inject(Actions);
  private sub!: Subscription;

  get defaultHarnesses() {
    return this.harnesses.filter(h => h.isDefault);
  }

  ngOnInit() {
    this.sub = this.actions$.pipe(
      ofType(createHarnessSuccess, createHarnessFailure, makeHarnessActiveSuccess, makeHarnessActiveFailure)
    ).subscribe((action) => {
      this.isSaving = false;
      if (action.type === createHarnessSuccess.type) {
        this.closeModal();
      }
      if (action.type === makeHarnessActiveSuccess.type || action.type === makeHarnessActiveFailure.type) {
        this.togglingHarnessId.set(null);
      }
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  openModal() {
    this.newCode = '';
    this.newName = '';
    if (this.defaultHarnesses.length > 0) {
      this.cloneFromId = this.defaultHarnesses[0].id;
    }
    this.showModal = true;
  }

  closeModal() {
    if (this.isSaving) return;
    this.showModal = false;
  }

  onSave() {
    if (!this.newCode.trim() || !this.newName.trim()) {
      alert("Both Code and Name are required.");
      return;
    }
    this.isSaving = true;
    this.createHarness.emit({
      code: this.newCode.trim(),
      name: this.newName.trim(),
      cloneFromHarnessId: this.cloneFromId || undefined
    });
  }

  onActivate(harness: Harness) {
    this.togglingHarnessId.set(harness.id);
    this.activateHarness.emit(harness);
  }
}
