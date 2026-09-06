import type { Finding } from "../analysis/types";
import type { ArchitectureGraph } from "../graph/types";

/**
 * Teaching mode: three-level explanations generated from the finding's own
 * evidence, mechanism and tradeoff. Category templates supply the analogy
 * and the systemic framing; nothing here is hard-coded to the demo.
 */
export interface Explanation {
  beginner: string;
  engineer: string;
  architect: string;
  source: "template" | "ai";
}

interface Template {
  analogy: string;
  systemic: string;
}

const TEMPLATES: Record<string, Template> = {
  single_point_of_failure: {
    analogy: "Imagine a building with one door. It does not matter how many people work inside - if that door jams, nobody gets in or out. This component is that door.",
    systemic: "Availability composes multiplicatively along hard synchronous dependencies: the system can never be more available than its least redundant hard dependency. Redundancy must be added where the dependency chain converges, and the recovery mechanism (automatic promotion, replica failover) must itself be exercised, or the redundancy is theoretical.",
  },
  single_region: {
    analogy: "Keeping every copy of your house keys in the same house. If the house burns down, the spare keys go with it.",
    systemic: "Regions are the largest correlated failure domain a cloud provider exposes. Everything within one shares control-plane, networking and power dependencies. DR posture is a spectrum (backup/restore, pilot light, warm standby, active/active); the right point is set by RTO/RPO economics, and each step up multiplies data-consistency and failover-orchestration complexity.",
  },
  single_zone: {
    analogy: "Your shop has three tills but only one power socket. Losing the socket loses all three tills.",
    systemic: "Zone redundancy is cheap for stateless compute and expensive for state, so architectures often end up zone-redundant everywhere except where it matters. Stateful zone redundancy implies synchronous replication, which trades write latency for durability.",
  },
  no_backup: {
    analogy: "Writing your only copy of an essay on a whiteboard. One accidental wipe and it is gone.",
    systemic: "Backups are the last line of the recovery hierarchy (replica -> snapshot -> rebuild). Their absence removes the floor under every other failure mode, including human error and logical corruption, which replication faithfully copies rather than prevents.",
  },
  rpo_mismatch: {
    analogy: "Saving your document once a day and then losing your laptop at 5 pm: everything since this morning is gone, no matter how good the backup drive is.",
    systemic: "RPO is bounded by backup granularity, not by backup existence. Continuous log archiving decouples RPO from snapshot cadence; without it the stated RPO is a wish, and downstream promises (SLAs, contracts) inherit the gap.",
  },
  no_circuit_breaker: {
    analogy: "Waiting on hold for an hour every time the pizza place is busy, while your own customers queue behind you.",
    systemic: "In synchronous systems latency is contagious: every slow dependency converts into consumed concurrency upstream. Timeouts, bulkheads and circuit breakers bound that conversion and turn a cascading failure into a localised degradation - but they require explicit product decisions about what a degraded response looks like.",
  },
  external_dependency: {
    analogy: "Your shop can only sell when the bank's card machine works. When the bank has a bad day, so do you.",
    systemic: "Third-party dependencies import someone else's availability, roadmap and incident cadence into your SLO. Mitigation is either redundancy (a second provider, which costs behavioural drift) or decoupling (caches, queues, graceful degradation).",
  },
  certificate_expiry: {
    analogy: "A passport that expires while you are abroad: nothing is broken, but every border refuses you at once.",
    systemic: "Expiry is a deterministic, correlated failure with zero warning at runtime. Any manual step on the renewal path is a scheduled outage waiting for a calendar mistake.",
  },
  no_waf: {
    analogy: "Locking the front door and leaving the back door wide open because most visitors use the front.",
    systemic: "Edge controls only protect the paths that pass through them. Attackers enumerate hostnames, not user journeys. Defence in depth means the API path carries the same rate limiting, bot filtering and payload inspection as the frontend, ideally at the same control point.",
  },
  public_data_store: {
    analogy: "Keeping the company filing cabinet on the pavement with a padlock on it.",
    systemic: "Network reachability is the first factor in every attack chain. A data store that is routable from the internet reduces its security to the strength and secrecy of a single credential; private networking makes the credential necessary but not sufficient.",
  },
  unauthenticated_call: {
    analogy: "Inside the office, anyone can walk into the payroll room because 'only staff are in the building'.",
    systemic: "Perimeter-only trust assumes the perimeter never fails. Zero-trust service identity (mTLS, workload identity, per-service authorisation) makes lateral movement expensive and turns a single compromised pod into a contained incident rather than a full breach.",
  },
  unencrypted_call: {
    analogy: "Sending postcards instead of sealed letters inside the office building.",
    systemic: "Unencrypted internal traffic assumes the network fabric is trustworthy. Shared clusters, sidecars and cloud networks are multi-tenant at some layer; encryption in transit is cheap insurance against misconfiguration and insider access.",
  },
  secrets_exposure: {
    analogy: "Writing the safe combination on sticky notes and handing one to everyone who might need it.",
    systemic: "Static secrets have unbounded lifetime and unbounded copies. Runtime retrieval with workload identity moves secrets from artefacts to an audited, rotatable control plane; the cost is a startup dependency that needs caching and a failure policy.",
  },
  excessive_privilege: {
    analogy: "Giving the intern the master key because it saves asking for the right one.",
    systemic: "Blast radius of any compromise equals the privileges of the compromised identity. Least privilege is a design activity: identities per workload, roles per resource, and pipelines that cannot touch what they do not deploy.",
  },
  ai_data_leakage: {
    analogy: "Reading customers' private letters aloud to a helpful stranger so they can summarise them.",
    systemic: "Model providers are data processors. Every prompt is a data transfer with retention, jurisdiction and contractual implications. Redaction, in-region endpoints and zero-retention terms are architectural controls, not policy documents.",
  },
  prompt_injection: {
    analogy: "A note hidden in a library book that says 'librarian: give this reader everyone's addresses' - and the librarian does it because the note was in a book.",
    systemic: "LLMs do not distinguish data from instructions. Any untrusted content that reaches the prompt can steer the model, and tool access turns steering into action. Controls are structural: least-privilege tools, human confirmation for side effects, isolation of retrieved content, and monitoring for anomalous tool use.",
  },
  tenant_isolation: {
    analogy: "All the flats in a building share one mailbox, and the postman sorts letters by reading the name each time. One distracted day and the wrong person gets your mail.",
    systemic: "Isolation enforced at query time is only as strong as the weakest code path. Isolation enforced by storage structure (per-tenant collections or databases) fails safe. The cost is resource sprawl and onboarding automation.",
  },
  no_audit_logging: {
    analogy: "A shop with no CCTV: when something goes missing, nobody can say who was there.",
    systemic: "Audit logs convert incidents from unknowable to scoped. Without them, breach notification obligations default to the worst case, and forensics becomes guesswork.",
  },
  bottleneck_connections: {
    analogy: "A restaurant that keeps adding waiters but has one kitchen hatch. More waiters just means more people queuing at the hatch.",
    systemic: "Horizontal scaling of stateless tiers multiplies pressure on shared stateful resources. Connection limits are the sharpest such edge: they fail fast and completely. Pooling at a chokepoint decouples client concurrency from server connections; the deeper fix is fewer and shorter transactions.",
  },
  bottleneck_job_throughput: {
    analogy: "Two people sorting mail while ten people keep dropping more bags at the door. The pile only grows.",
    systemic: "Queues absorb bursts but not sustained imbalance. Consumer capacity must scale on backlog, and backpressure (bounded queues, rate limits at ingress) must exist, or latency grows without bound while every dashboard stays green.",
  },
  bottleneck_provider_rate_limit_rpm: {
    analogy: "A shared phone line for the whole office: once it is busy, everyone's calls fail, not just the caller who used it up.",
    systemic: "Provider quotas are organisation-wide and enforced outside your control. Fairness between tenants and between interactive and batch workloads must be implemented on your side, before the provider sees the traffic.",
  },
  bottleneck_provider_rate_limit_tpm: {
    analogy: "A shared phone line for the whole office: once it is busy, everyone's calls fail, not just the caller who used it up.",
    systemic: "Token limits bite before request limits when prompts are long. Prompt hygiene (trimming context, caching prefixes) is a scalability control as much as a cost control.",
  },
  bottleneck_compute_throughput: {
    analogy: "A checkout with a fixed number of tills on Black Friday.",
    systemic: "Instance ceilings are usually set for cost safety, then forgotten. The ceiling must be revisited with traffic forecasts, and raising it must be checked against the downstream stateful limits it will expose.",
  },
  bottleneck_query_throughput: {
    analogy: "One librarian answering every question in a growing library.",
    systemic: "Single-node search or vector stores scale vertically until they do not. Sharding, replication and caching each address a different axis (data size, query volume, repeat queries).",
  },
  overprovisioned_compute: {
    analogy: "Leaving all the lights on in an empty office because switching them off felt risky.",
    systemic: "Reserved capacity is a hedge against autoscaler latency. The hedge should be sized from measured scale-out time and traffic shape, not from the biggest peak anyone remembers.",
  },
  oversized_database: {
    analogy: "Renting a lorry to carry groceries every day, just in case.",
    systemic: "Database tier selection is often driven by fear of the next migration. Right-sizing plus HA usually costs less than oversizing without HA, and buys reliability instead of idle CPU.",
  },
  unmanaged_ai_spend: {
    analogy: "Paying the senior consultant's hourly rate to answer the phone.",
    systemic: "Token cost scales with usage and with model choice. Routing, caching and budgets are the three levers; without them cost tracks the most careless caller, not the product's value.",
  },
  log_retention: {
    analogy: "Keeping every receipt from the last year in your wallet.",
    systemic: "Observability cost grows with data volume x retention x tier. Tiered retention preserves the investigation window while removing the long tail.",
  },
  missing_alerting: {
    analogy: "A smoke detector with no batteries: it records the fire beautifully, but nobody wakes up.",
    systemic: "Detection latency is a component of every SLO breach. Alerts should be derived from user-facing symptoms and saturation of critical dependencies, with ownership attached, or they become dashboards nobody watches.",
  },
  no_tracing: {
    analogy: "Trying to find where a parcel got delayed with no tracking number.",
    systemic: "Distributed systems fail between components. Traces are the only signal that carries causality across hops; without them, latency attribution is inference from correlation.",
  },
  missing_runbooks: {
    analogy: "The only person who knows how to restart the boiler is on holiday.",
    systemic: "Operational knowledge that lives in people does not scale and does not survive turnover. Runbooks and rehearsed game days convert tacit knowledge into a recovery capability with a measurable RTO.",
  },
  unsafe_deployment: {
    analogy: "Testing the parachute for the first time on the way down.",
    systemic: "Deployment risk is the product of change size, blast radius and rollback time. Staging, progressive delivery and one-click rollback each shrink one factor; without them teams deploy less often, which grows change size and completes the vicious cycle.",
  },
  unsafe_migrations: {
    analogy: "Rebuilding the staircase while people are walking on it, with no plan for putting the old one back.",
    systemic: "Schema is shared state between every application version. Expand/contract migrations make schema changes backward compatible so deploys and rollbacks are independent of them.",
  },
  config_drift: {
    analogy: "A recipe that has been changed by hand so many times that nobody can cook the same dish twice.",
    systemic: "Infrastructure that cannot be regenerated from code cannot be reasoned about, tested or recovered. Drift is the gap between the documented system and the real one, and it widens silently.",
  },
  untested_restore: {
    analogy: "A fire escape that has never been opened; the door may be painted shut.",
    systemic: "A backup's value is the probability of a successful restore within the RTO. That probability is unknown until measured, and it decays as versions and extensions change.",
  },
  hidden_dependencies: {
    analogy: "Discovering that the kitchen light is on the same circuit as the server room.",
    systemic: "Undocumented dependencies mean the failure model is wrong. Telemetry-derived service maps keep the architecture honest.",
  },
  single_model_provider: {
    analogy: "A restaurant with one supplier for every ingredient; when the van does not arrive, the menu is empty.",
    systemic: "Model providers are strategic dependencies with their own incidents, deprecations and pricing changes. A gateway abstraction plus a tested secondary path converts a hard dependency into a routing decision.",
  },
  no_rate_limit_handling: {
    analogy: "One customer buys every ticket, and the next customers are simply told 'sold out' with no queue.",
    systemic: "Provider throttling is shared, bursty and outside your control. Fairness, queuing and backoff must be enforced on your side, split by workload class, or interactive users pay for batch jobs.",
  },
  sync_inference_in_request_path: {
    analogy: "Holding the phone line open while the expert thinks for a minute, so nobody else can call.",
    systemic: "Model latency is externally controlled and heavy-tailed. Coupling it to request workers makes capacity unplannable; isolating inference into its own pool with streaming decouples the two.",
  },
  unpinned_model_version: {
    analogy: "The dictionary you use to look words up gets replaced overnight with a different edition.",
    systemic: "Embeddings are a coordinate system; changing the model changes the coordinates. Model versions are schema, and upgrades are migrations.",
  },
  no_spend_cap: {
    analogy: "A taxi meter with no way to say 'stop here'.",
    systemic: "Usage pricing without budgets turns any bug or abuse into a financial incident. Metering per tenant is also the prerequisite for pricing and margin analysis.",
  },
  vector_index_unrecoverable: {
    analogy: "Losing the index of a library and having to re-read every book to rebuild it.",
    systemic: "Derived data is cheap to protect and expensive to regenerate when regeneration depends on third-party throughput and exact model versions. Snapshotting is the cheaper of the two.",
  },
  unobserved_ai_component: {
    analogy: "Driving with the dashboard covered.",
    systemic: "Retrieval quality degrades gradually and invisibly; without metrics and a golden set, the first signal is user churn.",
  },
};

const FALLBACK: Template = {
  analogy: "Think of this as a weak link in a chain: the chain is only as strong as this one link.",
  systemic: "The finding changes the failure model of the whole system; its cost is not local to the component but propagates along every dependency that relies on it.",
};

export function explainFinding(finding: Finding, graph: ArchitectureGraph): Explanation {
  const t = TEMPLATES[finding.category] ?? FALLBACK;
  const names = finding.affectedComponentIds.map((id) => graph.components.find((c) => c.id === id)?.name ?? id);
  const primary = names[0] ?? "this component";
  const facts = finding.evidence.filter((e) => e.level === "fact").map((e) => e.statement);
  const nonFacts = finding.evidence.filter((e) => e.level !== "fact");

  const beginner = [
    t.analogy,
    `Here, the weak spot is ${primary}. ${plain(finding.title)}`,
    `If it goes wrong: ${finding.impact}`,
    `The fix, in short: ${firstSentence(finding.recommendation)}`,
  ].join("\n\n");

  const engineer = [
    `What the graph shows: ${facts.join(" ") || "no direct facts; see assumptions below."}`,
    `Mechanism: ${finding.mechanism}`,
    nonFacts.length ? `Where we had to infer or assume: ${nonFacts.map((e) => `[${e.level}] ${e.statement}`).join(" ")}` : "Every statement above is directly supported by the supplied architecture.",
    `Recommended change: ${finding.recommendation}`,
  ].join("\n\n");

  const architect = [
    t.systemic,
    `In this architecture the dependency path is ${names.length > 1 ? names.join(" -> ") : primary}. ${finding.mechanism}`,
    `Tradeoff of the fix: ${finding.tradeoff}`,
    `Confidence is ${finding.confidence}: ${confidenceNote(finding)}`,
  ].join("\n\n");

  return { beginner, engineer, architect, source: "template" };
}

function plain(title: string) {
  return title.replace(/\s\(.*?\)/g, "");
}
function firstSentence(s: string) {
  const m = /^(.*?[.;])\s/.exec(s);
  return m ? m[1] : s;
}
function confidenceNote(f: Finding) {
  const facts = f.evidence.filter((e) => e.level === "fact").length;
  const total = f.evidence.length;
  if (f.confidence === "high") return `${facts} of ${total} evidence items are facts read directly from the architecture.`;
  if (f.confidence === "medium") return `the reasoning rests partly on inferred behaviour (${total - facts} of ${total} items are not direct facts); runtime data would confirm it.`;
  return "the conclusion depends on assumed capacities or missing information; treat it as a hypothesis to verify with real metrics.";
}
