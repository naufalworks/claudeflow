import { render, screen } from '@testing-library/react';
import Badge from '@/components/ui/Badge';

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('applies default variant by default', () => {
    const { container } = render(<Badge>Default</Badge>);
    const badge = container.firstChild;
    expect(badge).toHaveClass('bg-surface-2', 'text-text-muted');
  });

  it('applies primary variant when specified', () => {
    const { container } = render(<Badge variant="primary">Primary</Badge>);
    const badge = container.firstChild;
    expect(badge).toHaveClass('bg-brand-500/10');
  });

  it('applies success variant when specified', () => {
    const { container } = render(<Badge variant="success">Success</Badge>);
    const badge = container.firstChild;
    expect(badge).toHaveClass('bg-green-500/10');
  });

  it('applies warning variant when specified', () => {
    const { container } = render(<Badge variant="warning">Warning</Badge>);
    const badge = container.firstChild;
    expect(badge).toHaveClass('bg-yellow-500/10');
  });

  it('applies error variant when specified', () => {
    const { container } = render(<Badge variant="error">Error</Badge>);
    const badge = container.firstChild;
    expect(badge).toHaveClass('bg-red-500/10');
  });

  it('applies info variant when specified', () => {
    const { container } = render(<Badge variant="info">Info</Badge>);
    const badge = container.firstChild;
    expect(badge).toHaveClass('bg-blue-500/10');
  });

  it('applies correct size classes', () => {
    const { container, rerender } = render(<Badge size="sm">Small</Badge>);
    expect(container.firstChild).toHaveClass('px-2', 'py-0.5', 'text-[10px]');

    rerender(<Badge size="md">Medium</Badge>);
    expect(container.firstChild).toHaveClass('px-2.5', 'py-1', 'text-xs');

    rerender(<Badge size="lg">Large</Badge>);
    expect(container.firstChild).toHaveClass('px-3', 'py-1.5', 'text-sm');
  });

  it('renders dot when dot prop is true', () => {
    const { container } = render(<Badge dot variant="success">With Dot</Badge>);
    const dot = container.querySelector('.size-1\\.5');
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveClass('bg-green-500');
  });

  it('renders correct dot color for each variant', () => {
    const { container, rerender } = render(<Badge dot variant="success">Success</Badge>);
    let dot = container.querySelector('.size-1\\.5');
    expect(dot).toHaveClass('bg-green-500');

    rerender(<Badge dot variant="warning">Warning</Badge>);
    dot = container.querySelector('.size-1\\.5');
    expect(dot).toHaveClass('bg-yellow-500');

    rerender(<Badge dot variant="error">Error</Badge>);
    dot = container.querySelector('.size-1\\.5');
    expect(dot).toHaveClass('bg-red-500');

    rerender(<Badge dot variant="info">Info</Badge>);
    dot = container.querySelector('.size-1\\.5');
    expect(dot).toHaveClass('bg-blue-500');

    rerender(<Badge dot variant="primary">Primary</Badge>);
    dot = container.querySelector('.size-1\\.5');
    expect(dot).toHaveClass('bg-brand-500');

    rerender(<Badge dot variant="default">Default</Badge>);
    dot = container.querySelector('.size-1\\.5');
    expect(dot).toHaveClass('bg-gray-500');
  });

  it('renders icon when provided', () => {
    render(<Badge icon="check">Verified</Badge>);
    expect(screen.getByText('check')).toBeInTheDocument();
  });

  it('renders both dot and icon when both are provided', () => {
    const { container } = render(<Badge dot icon="check" variant="success">Complete</Badge>);
    expect(container.querySelector('.size-1\\.5')).toBeInTheDocument();
    expect(screen.getByText('check')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<Badge className="custom-class">Custom</Badge>);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
