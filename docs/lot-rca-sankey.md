# Lot RCA Sankey investigation map

In YMS AI Assistance, run Lot root cause analysis and open Sankey map. The existing Investigation map remains available. The Sankey traces validated positive reject records through lot, operation sequence/WIP_OPTN_CODE, recorded machine identity, and reject code/description. Bands show summed reject quantity for each path, not a statistical correlation coefficient, process throughput, or proven causal relationship. Machine nodes are scoped per operation to avoid mixing paths across different route steps.

Use Top 10/20/30 evidence paths. Select a colored node with the mouse or keyboard (Enter/Space) to filter the supporting evidence table; Clear selected factor restores all displayed paths. Coverage shows displayed quantity as a percentage of the full validated lot reject-detail total and reports omitted quantities. The database query aggregates across the entire lot and returns the top 60 groups, independent of the 100-row reject-history detail cap. Rework and invalid records do not contribute to band weights. Planned test/sampling/setup removals can still be present in valid source data and require engineering disposition review. Materials are shown in Tables without inventing defect attribution.

All data comes from PostgreSQL. Visualization groups are excluded from the LLM prompt because their observations are already represented in the model's bounded reject evidence. Existing saved responses without Sankey evidence show an empty state and require rerunning the analysis.

Validation 2026-10-09: two graph tests passed for flow conservation, per-operation machine separation, invalid weights and empty evidence. API and web production builds and web type check passed. Website and API readiness returned HTTP 200 after deployment. Warehouse lot BOGET0040.1 had five aggregated paths totaling 200 validated reject units, matching its complete reject-detail total.

Browser verification: a live local-model lot analysis exposed the Sankey map tab with all five paths and 100% quantity coverage. Selecting DIE ATTACH filtered supporting evidence to the ESEC-301/P / DZZ path and its 100 reject units.
