import { render, screen } from '@testing-library/react';
import Card from '@/components/ui/Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(<Card title="Card Title">Content</Card>);
    expect(screen.getByText('Card Title')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<Card title="Title" subtitle="Subtitle">Content</Card>);
    expect(screen.getByText('Subtitle')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<Card icon="dashboard">Content</Card>);
    expect(screen.getByText('dashboard')).toBeInTheDocument();
  });

  it('renders action element when provided', () => {
    render(
      <Card action={<button>Action</button>}>Content</Card>
    );
    expect(screen.getByRole('button', { name: /action/i })).toBeInTheDocument();
  });

  it('applies hover styles when hover prop is true', () => {
    const { container } = render(<Card hover>Content</Card>);
    const card = container.firstChild;
    expect(card).toHaveClass('hover:shadow-[var(--shadow-warm)]');
    expect(card).toHaveClass('cursor-pointer');
  });

  it('applies elevation shadow when elev prop is true', () => {
    const { container } = render(<Card elev>Content</Card>);
    const card = container.firstChild;
    expect(card).toHaveClass('shadow-[var(--shadow-elev)]');
  });

  it('applies correct padding classes', () => {
    const { container, rerender } = render(<Card padding="none">Content</Card>);
    expect(container.firstChild).not.toHaveClass('p-3', 'p-4', 'p-6', 'p-8');

    rerender(<Card padding="xs">Content</Card>);
    expect(container.firstChild).toHaveClass('p-3');

    rerender(<Card padding="sm">Content</Card>);
    expect(container.firstChild).toHaveClass('p-4');

    rerender(<Card padding="md">Content</Card>);
    expect(container.firstChild).toHaveClass('p-6');

    rerender(<Card padding="lg">Content</Card>);
    expect(container.firstChild).toHaveClass('p-8');
  });

  it('applies custom className', () => {
    const { container } = render(<Card className="custom-class">Content</Card>);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  describe('Card.Section', () => {
    it('renders section content', () => {
      render(
        <Card>
          <Card.Section>Section content</Card.Section>
        </Card>
      );
      expect(screen.getByText('Section content')).toBeInTheDocument();
    });

    it('applies section styles', () => {
      const { container } = render(
        <Card>
          <Card.Section>Section</Card.Section>
        </Card>
      );
      const section = screen.getByText('Section').parentElement;
      expect(section).toHaveClass('p-4', 'rounded-[10px]', 'bg-bg');
    });
  });

  describe('Card.Row', () => {
    it('renders row content', () => {
      render(
        <Card>
          <Card.Row>Row content</Card.Row>
        </Card>
      );
      expect(screen.getByText('Row content')).toBeInTheDocument();
    });

    it('applies row styles with border', () => {
      const { container } = render(
        <Card>
          <Card.Row>Row</Card.Row>
        </Card>
      );
      const row = screen.getByText('Row').parentElement;
      expect(row).toHaveClass('border-b', 'border-border-subtle');
    });
  });

  describe('Card.ListItem', () => {
    it('renders list item content', () => {
      render(
        <Card>
          <Card.ListItem>List item</Card.ListItem>
        </Card>
      );
      expect(screen.getByText('List item')).toBeInTheDocument();
    });

    it('renders actions when provided', () => {
      render(
        <Card>
          <Card.ListItem actions={<button>Delete</button>}>
            Item
          </Card.ListItem>
        </Card>
      );
      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    });

    it('applies list item styles', () => {
      const { container } = render(
        <Card>
          <Card.ListItem>Item</Card.ListItem>
        </Card>
      );
      const item = screen.getByText('Item').parentElement?.parentElement;
      expect(item).toHaveClass('group', 'flex', 'items-center');
    });
  });
});
