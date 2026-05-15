import { UIComponent } from '../lib/types';
import MetricCard from './MetricCard';
import InsightCard from './InsightCard';
import RecommendationCard from './RecommendationCard';

interface DynamicComponentsProps {
  components: UIComponent[];
}

export default function DynamicComponents({ components }: DynamicComponentsProps) {
  const renderComponent = (component: UIComponent) => {
    switch (component.type) {
      case 'metric_card':
        return <MetricCard key={component.title} component={component} />;
      case 'insight_card':
        return <InsightCard key={component.title} component={component} />;
      case 'recommendation_card':
        return <RecommendationCard key={component.title} asset={component as any} />;
      default:
        return null;
    }
  };

  return (
    <div style={{ margin: '2rem 0' }}>
      <h2 style={{ marginBottom: '1rem', fontSize: '1.125rem' }}>Dynamic Components</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        {components.map((component, index) => (
          <div key={index}>{renderComponent(component)}</div>
        ))}
      </div>
    </div>
  );
}