import { Component, Input, Output, EventEmitter } from '@angular/core';
import { Harness, AgentConfig } from '../../domain/harness.model';

@Component({
  selector: 'app-graph-flow',
  standalone: true,
  imports: [],
  templateUrl: './graph-flow.component.html',
  styleUrl: './graph-flow.component.css',
})
export class GraphFlowComponent {
  @Input() harness: Harness | null = null;
  @Input() agentStates: Record<string, string> = {};
  @Input() selectedAgent: AgentConfig | null = null;
  @Input() consoleLogs: string[] = [];
  @Input() showConsole = false;
  @Input() isLoading = false;

  @Output() selectAgent = new EventEmitter<AgentConfig>();
  @Output() toggleConsole = new EventEmitter<void>();
  @Output() clearLogs = new EventEmitter<void>();

  getAgentByRole(role: string): AgentConfig | undefined {
    return this.harness?.agents?.find((a) => a.role === role.toLowerCase());
  }
}
