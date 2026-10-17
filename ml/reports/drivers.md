# Funnel driver simulation

Seed 20261017; 200 repeats per power cell; 500 all-null funnels. The production `conversion_drivers` function is used unchanged.

| Entered | True desktop rate ratio | Found / trials | Power | 95% Monte Carlo interval |
|---:|---:|---:|---:|---:|
| 200 | 1.5× | 24 / 200 | 12.0% | 8.2%–17.2% |
| 200 | 2.0× | 105 / 200 | 52.5% | 45.6%–59.3% |
| 1000 | 1.5× | 152 / 200 | 76.0% | 69.6%–81.4% |
| 1000 | 2.0× | 200 / 200 | 100.0% | 98.1%–100.0% |
| 5000 | 1.5× | 200 / 200 | 100.0% | 98.1%–100.0% |
| 5000 | 2.0× | 200 / 200 | 100.0% | 98.1%–100.0% |

All-null false-driver rate: **37/500 = 7.4%** (95% Wilson interval 5.4%–10.0%); BH target q < 10%.

Visitors are independent person-days, half desktop. Baseline conversion probability is 15%; desktop is 22.5% or 30%, so these are true **risk ratios**, not odds ratios. Referrer, entry page, country and browser are independently assigned, have no causal effect, and are tested alongside both device values. The same minimum 30 inside/outside rule, two-sided Fisher tests, BH correction across every eligible attribute value, and five-per-direction display cap are applied.

Power is the proportion of runs where the displayed desktop/better driver is found. The null measure is the proportion of funnels with any displayed false driver. Under the complete null, every discovery is false, so this estimates FDR itself (also family-wise error), rather than the misleading fraction of individual tests that reject. Monte Carlo intervals describe uncertainty from the finite simulation, not uncertainty in a customer insight.

Small samples can have low power even when a real effect exists. Large sample sizes help; absence of a driver is not evidence of equal conversion. These trials do not establish FDR control under arbitrary dependence, repeated daily monitoring, across multiple funnels, or partial-null mixtures. Real attributes are correlated, and these are associations, not proof that changing an attribute causes conversion. Displayed odds-ratio confidence intervals use the +0.5 Haldane correction and normal log-OR approximation; they are not adjusted for selection or multiple comparisons.

Reproduce from `ml/`: `python -m footfall_ml.drivers_simulation --repeats 200 --null-repeats 500 --seed 20261017`.
