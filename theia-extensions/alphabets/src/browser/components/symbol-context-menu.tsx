import * as React from 'react';

export interface SymbolContextMenuProps {
    x: number;
    y: number;
    symbolIndex: number;
    onDelete: () => void;
    onDuplicate: () => void;
    onInsertBefore: () => void;
    onInsertAfter: () => void;
    onClose: () => void;
}

/**
 * Menu contextuel pour un symbole entré.
 */
export class SymbolContextMenu extends React.Component<SymbolContextMenuProps> {

    componentDidMount(): void {
        // Fermer le menu si on clique en dehors
        document.addEventListener('click', this.handleOutsideClick);
        document.addEventListener('contextmenu', this.handleOutsideClick);
    }

    componentWillUnmount(): void {
        document.removeEventListener('click', this.handleOutsideClick);
        document.removeEventListener('contextmenu', this.handleOutsideClick);
    }

    private handleOutsideClick = () => {
        this.props.onClose();
    };

    private handleMenuItemClick = (action: () => void) => {
        action();
        this.props.onClose();
    };

    render(): React.ReactNode {
        const { x, y, symbolIndex } = this.props;

        const menuStyle: React.CSSProperties = {
            position: 'fixed',
            left: `${x}px`,
            top: `${y}px`,
            backgroundColor: 'var(--theia-menu-background)',
            border: '1px solid var(--theia-menu-border)',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            padding: '4px 0',
            zIndex: 10000,
            minWidth: '200px'
        };

        const menuItemStyle: React.CSSProperties = {
            padding: '8px 16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: 'var(--theia-menu-foreground)',
            backgroundColor: 'transparent',
            border: 'none',
            width: '100%',
            textAlign: 'left'
        };

        return (
            <div
                style={menuStyle}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.stopPropagation()}
            >
                <button
                    style={menuItemStyle}
                    onClick={() => this.handleMenuItemClick(this.props.onDelete)}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--theia-menu-selectionBackground)')}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                    <i className='fa fa-trash' style={{ width: '16px' }}></i>
                    <span>Supprimer</span>
                </button>
                <button
                    style={menuItemStyle}
                    onClick={() => this.handleMenuItemClick(this.props.onDuplicate)}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--theia-menu-selectionBackground)')}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                    <i className='fa fa-copy' style={{ width: '16px' }}></i>
                    <span>Dupliquer</span>
                </button>
                <div style={{
                    height: '1px',
                    backgroundColor: 'var(--theia-menu-separatorBackground)',
                    margin: '4px 0'
                }}></div>
                <button
                    style={menuItemStyle}
                    onClick={() => this.handleMenuItemClick(this.props.onInsertBefore)}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--theia-menu-selectionBackground)')}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                    <i className='fa fa-arrow-left' style={{ width: '16px' }}></i>
                    <span>Insérer avant</span>
                </button>
                <button
                    style={menuItemStyle}
                    onClick={() => this.handleMenuItemClick(this.props.onInsertAfter)}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--theia-menu-selectionBackground)')}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                    <i className='fa fa-arrow-right' style={{ width: '16px' }}></i>
                    <span>Insérer après</span>
                </button>
            </div>
        );
    }
}

