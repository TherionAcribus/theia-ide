import * as React from 'react';

export interface SymbolItemProps {
    char: string;
    index: number;
    scale: number;
    fontFamily?: string;
    imagePath?: string;
    isDraggable?: boolean;
    showIndex?: boolean;
    onDragStart?: (index: number) => void;
    onDragOver?: (index: number) => void;
    onDragEnd?: () => void;
    onContextMenu?: (e: React.MouseEvent, index: number) => void;
    onClick?: (char: string) => void;
}

/**
 * Composant pour afficher un symbole d'alphabet (avec drag & drop et menu contextuel).
 */
export class SymbolItem extends React.Component<SymbolItemProps> {

    private handleDragStart = (e: React.DragEvent) => {
        if (this.props.isDraggable && this.props.onDragStart) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.props.index.toString());
            this.props.onDragStart(this.props.index);
        }
    };

    private handleDragOver = (e: React.DragEvent) => {
        if (this.props.isDraggable && this.props.onDragOver) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.props.onDragOver(this.props.index);
        }
    };

    private handleDragEnd = () => {
        if (this.props.isDraggable && this.props.onDragEnd) {
            this.props.onDragEnd();
        }
    };

    private handleContextMenu = (e: React.MouseEvent) => {
        if (this.props.onContextMenu) {
            e.preventDefault();
            this.props.onContextMenu(e, this.props.index);
        }
    };

    private handleClick = () => {
        if (this.props.onClick) {
            this.props.onClick(this.props.char);
        }
    };

    render(): React.ReactNode {
        const { char, index, scale, fontFamily, imagePath, isDraggable, showIndex } = this.props;

        const symbolStyle: React.CSSProperties = {
            width: `${96 * scale}px`,
            height: `${96 * scale}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: `${40 * scale}px`,
            position: 'relative',
            cursor: isDraggable ? 'move' : (this.props.onClick ? 'pointer' : 'default'),
            backgroundColor: 'var(--theia-input-background)',
            border: '1px solid var(--theia-input-border)',
            borderRadius: '4px',
            transition: 'all 0.2s',
            userSelect: 'none'
        };

        const content = fontFamily ? (
            <span style={{
                fontFamily: `"${fontFamily}", monospace`,
                fontSize: `${40 * scale}px`
            }}>
                {char}
            </span>
        ) : imagePath ? (
            <img
                src={imagePath}
                alt={char}
                style={{
                    maxWidth: '80%',
                    maxHeight: '80%',
                    objectFit: 'contain'
                }}
            />
        ) : (
            <span>{char}</span>
        );

        return (
            <div
                draggable={isDraggable}
                onDragStart={this.handleDragStart}
                onDragOver={this.handleDragOver}
                onDragEnd={this.handleDragEnd}
                onContextMenu={this.handleContextMenu}
                onClick={this.handleClick}
                style={symbolStyle}
                title={showIndex ? `Position: ${index + 1}` : char}
                className='alphabet-symbol-item'
            >
                {content}
                {showIndex && (
                    <div style={{
                        position: 'absolute',
                        bottom: '2px',
                        right: '4px',
                        fontSize: '10px',
                        color: 'var(--theia-descriptionForeground)',
                        backgroundColor: 'var(--theia-badge-background)',
                        padding: '1px 4px',
                        borderRadius: '2px'
                    }}>
                        {index + 1}
                    </div>
                )}
            </div>
        );
    }
}

