import { render, screen } from '@testing-library/react';
import QuotaGauge from '@/components/dashboard/QuotaGauge';

describe('QuotaGauge', () => {
  it('renders percentage value', () => {
    render(<QuotaGauge percentage={75} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('renders label when provided', () => {
    render(<QuotaGauge percentage={50} label="Usage" />);
    expect(screen.getByText('Usage')).toBeInTheDocument();
  });

  it('rounds percentage to nearest integer', () => {
    render(<QuotaGauge percentage={75.7} />);
    expect(screen.getByText('76%')).toBeInTheDocument();
  });

  it('applies green color for low usage (< 80%)', () => {
    render(<QuotaGauge percentage={50} />);
    const percentageText = screen.getByText('50%');
    expect(percentageText).toHaveClass('text-green-500');
  });

  it('applies yellow color for medium usage (80-89%)', () => {
    render(<QuotaGauge percentage={85} />);
    const percentageText = screen.getByText('85%');
    expect(percentageText).toHaveClass('text-yellow-500');
  });

  it('applies red color for high usage (>= 90%)', () => {
    render(<QuotaGauge percentage={95} />);
    const percentageText = screen.getByText('95%');
    expect(percentageText).toHaveClass('text-red-500');
  });

  it('applies correct size classes', () => {
    const { container, rerender } = render(<QuotaGauge percentage={50} size="sm" />);
    let svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '60');
    expect(svg).toHaveAttribute('height', '60');

    rerender(<QuotaGauge percentage={50} size="md" />);
    svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '80');
    expect(svg).toHaveAttribute('height', '80');

    rerender(<QuotaGauge percentage={50} size="lg" />);
    svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '100');
    expect(svg).toHaveAttribute('height', '100');
  });

  it('renders SVG circles', () => {
    const { container } = render(<QuotaGauge percentage={50} />);
    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(2); // Background and progress circles
  });

  it('applies custom className', () => {
    const { container } = render(<QuotaGauge percentage={50} className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('handles 0% correctly', () => {
    render(<QuotaGauge percentage={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('handles 100% correctly', () => {
    render(<QuotaGauge percentage={100} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
