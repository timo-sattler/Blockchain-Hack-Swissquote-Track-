import { Chevron } from './icons'
import { PLANS } from './mockData'
import { SqHeader } from './SqHeader'

export function PlanTab() {
  return (
    <>
      <SqHeader title="Plan" />
      <section className="sq-card sq-plan-hero">
        <p className="sq-muted-title">Your goals</p>
        <p className="sq-big-value">2 active plans</p>
        <p className="sq-muted">Invest regularly and let compounding do the work.</p>
      </section>
      <ul className="sq-plans">
        {PLANS.map((plan) => (
          <li key={plan.name} className="sq-card">
            <div>
              <strong>{plan.name}</strong>
              <span>{plan.detail}</span>
              <div className="sq-progress">
                <i style={{ width: `${plan.progress * 100}%` }} />
              </div>
              <span className="sq-muted">{plan.next}</span>
            </div>
            <Chevron />
          </li>
        ))}
      </ul>
      <button className="sq-primary">Create a new plan</button>
    </>
  )
}
