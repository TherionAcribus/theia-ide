import * as React from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    ColumnDef,
    flexRender,
    SortingState,
    ColumnFiltersState,
} from '@tanstack/react-table';
import { ContextMenu, ContextMenuItem } from './context-menu';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { GeocacheIcon } from './geocache-icon';

export interface GeocacheWaypoint {
    id: number;
    prefix: string | null;
    lookup: string | null;
    name: string | null;
    type: string | null;
    latitude: number | null;
    longitude: number | null;
    gc_coords: string | null;
    note: string | null;
}

export interface Geocache {
    id: number;
    gc_code: string;
    name: string;
    owner: string | null;
    cache_type: string;
    difficulty: number;
    terrain: number;
    size: string;
    solved: string;
    found: boolean;
    favorites_count: number;
    hidden_date: string | null;
    latitude?: number;
    longitude?: number;
    is_corrected?: boolean;
    original_latitude?: number;
    original_longitude?: number;
    original_coordinates_raw?: string;
    coordinates_raw?: string;
    description?: string;
    hint?: string;
    waypoints?: GeocacheWaypoint[];
}

interface GeocachesTableProps {
    data: Geocache[];
    onRowClick?: (geocache: Geocache) => void;
    onDeleteSelected?: (ids: number[]) => void;
    onRefreshSelected?: (ids: number[]) => void;
    onCopySelected?: (ids: number[]) => void;
    onMoveSelected?: (ids: number[]) => void;
    onApplyPluginSelected?: (ids: number[]) => void;
    onExportGpxSelected?: (ids: number[]) => void;
    onDelete?: (geocache: Geocache) => void;
    onRefresh?: (id: number) => void;
    onMove?: (geocache: Geocache, targetZoneId: number) => void;
    onCopy?: (geocache: Geocache, targetZoneId: number) => void;
    onImportAround?: (geocache: Geocache) => void;
    zones?: Array<{ id: number; name: string }>;
    currentZoneId?: number;
}

export const GeocachesTable: React.FC<GeocachesTableProps> = ({
    data,
    onRowClick,
    onDeleteSelected,
    onRefreshSelected,
    onCopySelected,
    onMoveSelected,
    onApplyPluginSelected,
    onExportGpxSelected,
    onDelete,
    onRefresh,
    onMove,
    onCopy,
    onImportAround,
    zones = [],
    currentZoneId
}) => {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [rowSelection, setRowSelection] = React.useState({});
    const [globalFilter, setGlobalFilter] = React.useState('');
    const [contextMenu, setContextMenu] = React.useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
    const [moveDialog, setMoveDialog] = React.useState<Geocache | null>(null);
    const [copyDialog, setCopyDialog] = React.useState<Geocache | null>(null);

    const columns = React.useMemo<ColumnDef<Geocache>[]>(
        () => [
            {
                id: 'select',
                header: ({ table }) => {
                    const checkboxRef = React.useRef<HTMLInputElement>(null);
                    React.useEffect(() => {
                        if (checkboxRef.current) {
                            checkboxRef.current.indeterminate = table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected();
                        }
                    }, [table.getIsSomeRowsSelected(), table.getIsAllRowsSelected()]);
                    
                    return (
                        <input
                            ref={checkboxRef}
                            type="checkbox"
                            checked={table.getIsAllRowsSelected()}
                            onChange={table.getToggleAllRowsSelectedHandler()}
                        />
                    );
                },
                cell: ({ row }) => (
                    <input
                        type="checkbox"
                        checked={row.getIsSelected()}
                        disabled={!row.getCanSelect()}
                        onChange={row.getToggleSelectedHandler()}
                        onClick={(e) => e.stopPropagation()}
                    />
                ),
                size: 40,
            },
            {
                accessorKey: 'gc_code',
                header: 'Code GC',
                cell: info => <strong>{info.getValue() as string}</strong>,
                size: 100,
            },
            {
                accessorKey: 'name',
                header: 'Nom',
                cell: info => (
                    <div style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {info.getValue() as string}
                    </div>
                ),
                size: 300,
            },
            {
                accessorKey: 'cache_type',
                header: 'Type',
                cell: info => {
                    const type = info.getValue() as string;
                    return (
                        <GeocacheIcon 
                            type={type} 
                            size={20}
                            showLabel={false}
                        />
                    );
                },
                size: 50,
            },
            {
                accessorKey: 'difficulty',
                header: 'D',
                cell: info => <span title="Difficulté">{info.getValue() as number}</span>,
                size: 60,
            },
            {
                accessorKey: 'terrain',
                header: 'T',
                cell: info => <span title="Terrain">{info.getValue() as number}</span>,
                size: 60,
            },
            {
                accessorKey: 'size',
                header: 'Taille',
                cell: info => {
                    const size = info.getValue() as string;
                    return (
                        <span style={{ fontSize: '0.85em' }} title={size}>
                            {size}
                        </span>
                    );
                },
                size: 100,
            },
            {
                accessorKey: 'solved',
                header: 'Statut',
                cell: info => {
                    const solved = info.getValue() as string;
                    return getStatusBadge(solved, (info.row.original as Geocache).found);
                },
                size: 100,
            },
            {
                accessorKey: 'favorites_count',
                header: '❤️',
                cell: info => <span title="Favoris">{info.getValue() as number}</span>,
                size: 50,
            },
            {
                accessorKey: 'owner',
                header: 'Propriétaire',
                cell: info => <span style={{ fontSize: '0.9em', opacity: 0.8 }}>{info.getValue() as string || '-'}</span>,
                size: 150,
            },
            {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => (
                    <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        {onRefresh && (
                            <button
                                onClick={() => onRefresh(row.original.id)}
                                className="theia-button secondary"
                                title="Rafraîchir cette géocache"
                                style={{ padding: '2px 6px', fontSize: '0.85em' }}
                            >
                                🔄
                            </button>
                        )}
                        {onDelete && (
                            <button
                                onClick={() => onDelete(row.original)}
                                className="theia-button secondary"
                                title="Supprimer cette géocache"
                                style={{ padding: '2px 6px', fontSize: '0.85em', color: 'var(--theia-errorForeground)' }}
                            >
                                🗑️
                            </button>
                        )}
                    </div>
                ),
                size: 100,
            },
        ],
        []
    );

    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
            columnFilters,
            rowSelection,
            globalFilter,
        },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onRowSelectionChange: setRowSelection,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        enableRowSelection: true,
    });

    const selectedRows = table.getSelectedRowModel().rows;
    const selectedIds = selectedRows.map(row => row.original.id);

    const showContextMenu = (geocache: Geocache, event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const items: ContextMenuItem[] = [
            {
                label: 'Ouvrir',
                icon: '📖',
                action: () => onRowClick?.(geocache)
            },
            {
                label: 'Rafraîchir',
                icon: '🔄',
                action: () => onRefresh?.(geocache.id)
            }
        ];

        // Ajouter l'option de déplacement si disponible
        if (onMove && zones.length > 1 && currentZoneId) {
            items.push({
                label: 'Déplacer vers...',
                icon: '📦',
                action: () => setMoveDialog(geocache)
            });
        }

        // Ajouter l'option de copie si disponible
        if (onCopy && zones.length > 1 && currentZoneId) {
            items.push({
                label: 'Copier vers...',
                icon: '📋',
                action: () => setCopyDialog(geocache)
            });
        }

        if (onImportAround) {
            items.push({
                label: 'Importer autour…',
                icon: '📍',
                action: () => onImportAround(geocache)
            });
        }

        items.push({ separator: true });
        items.push({
            label: 'Supprimer',
            icon: '🗑️',
            danger: true,
            action: () => onDelete?.(geocache)
        });

        setContextMenu({
            items,
            x: event.clientX,
            y: event.clientY
        });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                        type="text"
                        value={globalFilter ?? ''}
                        onChange={e => setGlobalFilter(e.target.value)}
                        placeholder="Rechercher..."
                        style={{
                            padding: '4px 8px',
                            border: '1px solid var(--theia-input-border)',
                            background: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            borderRadius: 3,
                            width: 200,
                        }}
                    />
                    <span style={{ fontSize: '0.9em', opacity: 0.7 }}>
                        {table.getFilteredRowModel().rows.length} géocache(s)
                    </span>
                </div>
                
                {selectedIds.length > 0 && (
                    <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ fontSize: '0.9em', opacity: 0.8 }}>
                            {selectedIds.length} sélectionnée(s)
                        </span>
                        {onApplyPluginSelected && (
                            <button
                                onClick={() => onApplyPluginSelected(selectedIds)}
                                className="theia-button primary"
                                title="Appliquer un plugin aux géocaches sélectionnées"
                            >
                                🔧 Appliquer un plugin
                            </button>
                        )}
                        {onExportGpxSelected && (
                            <button
                                onClick={() => onExportGpxSelected(selectedIds)}
                                className="theia-button secondary"
                                title="Exporter les géocaches sélectionnées au format GPX"
                            >
                                ⬇️ Exporter GPX
                            </button>
                        )}
                        {onRefreshSelected && (
                            <button
                                onClick={() => onRefreshSelected(selectedIds)}
                                className="theia-button secondary"
                                title="Rafraîchir les géocaches sélectionnées"
                            >
                                🔄 Rafraîchir
                            </button>
                        )}
                        {onCopySelected && zones.length > 1 && (
                            <button
                                onClick={() => onCopySelected(selectedIds)}
                                className="theia-button secondary"
                                title="Copier les géocaches sélectionnées vers une autre zone"
                            >
                                📋 Copier
                            </button>
                        )}
                        {onMoveSelected && zones.length > 1 && (
                            <button
                                onClick={() => onMoveSelected(selectedIds)}
                                className="theia-button secondary"
                                title="Déplacer les géocaches sélectionnées vers une autre zone"
                            >
                                📦 Déplacer
                            </button>
                        )}
                        {onDeleteSelected && (
                            <button
                                onClick={() => onDeleteSelected(selectedIds)}
                                className="theia-button secondary"
                                style={{ color: 'var(--theia-errorForeground)' }}
                                title="Supprimer les géocaches sélectionnées"
                            >
                                🗑️ Supprimer
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Table */}
            <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--theia-panel-border)', borderRadius: 3 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--theia-editor-background)', zIndex: 1 }}>
                        {table.getHeaderGroups().map(headerGroup => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map(header => (
                                    <th
                                        key={header.id}
                                        style={{
                                            padding: '8px 6px',
                                            textAlign: 'left',
                                            borderBottom: '1px solid var(--theia-panel-border)',
                                            cursor: header.column.getCanSort() ? 'pointer' : 'default',
                                            userSelect: 'none',
                                            fontWeight: 600,
                                        }}
                                        onClick={header.column.getToggleSortingHandler()}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                            {{
                                                asc: ' ⬆️',
                                                desc: ' ⬇️',
                                            }[header.column.getIsSorted() as string] ?? null}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {table.getRowModel().rows.map(row => (
                            <tr
                                key={row.id}
                                onClick={() => onRowClick?.(row.original)}
                                onContextMenu={(e) => showContextMenu(row.original, e)}
                                style={{
                                    cursor: 'pointer',
                                    background: row.getIsSelected()
                                        ? 'var(--theia-list-activeSelectionBackground)'
                                        : 'transparent',
                                }}
                                onMouseEnter={(e) => {
                                    if (!row.getIsSelected()) {
                                        (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!row.getIsSelected()) {
                                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                                    }
                                }}
                            >
                                {row.getVisibleCells().map(cell => (
                                    <td
                                        key={cell.id}
                                        style={{
                                            padding: '6px',
                                            borderBottom: '1px solid var(--theia-panel-border)',
                                        }}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Menu contextuel */}
            {contextMenu && (
                <ContextMenu
                    items={contextMenu.items}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Dialog de déplacement */}
            {moveDialog && onMove && currentZoneId && (
                <MoveGeocacheDialog
                    geocacheName={`${moveDialog.gc_code} - ${moveDialog.name}`}
                    currentZoneId={currentZoneId}
                    zones={zones}
                    onMove={(targetZoneId) => {
                        onMove(moveDialog, targetZoneId);
                        setMoveDialog(null);
                    }}
                    onCancel={() => setMoveDialog(null)}
                />
            )}

            {/* Dialog de copie */}
            {copyDialog && onCopy && currentZoneId && (
                <MoveGeocacheDialog
                    geocacheName={`${copyDialog.gc_code} - ${copyDialog.name}`}
                    currentZoneId={currentZoneId}
                    zones={zones}
                    onMove={(targetZoneId) => {
                        onCopy(copyDialog, targetZoneId);
                        setCopyDialog(null);
                    }}
                    onCancel={() => setCopyDialog(null)}
                    title="Copier vers une zone"
                    actionLabel="Copier"
                />
            )}
        </div>
    );
};

// Helper functions
function getStatusBadge(solved: string, found: boolean): React.ReactNode {
    if (found) {
        return (
            <span
                style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: '0.85em',
                    background: '#2ecc71',
                    color: '#fff',
                    fontWeight: 600,
                }}
                title="Trouvée"
            >
                ✓ Trouvée
            </span>
        );
    }
    if (solved === 'solved') {
        return (
            <span
                style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: '0.85em',
                    background: '#3498db',
                    color: '#fff',
                    fontWeight: 600,
                }}
                title="Résolue"
            >
                ✓ Résolue
            </span>
        );
    }
    if (solved === 'in_progress') {
        return (
            <span
                style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: '0.85em',
                    background: '#f39c12',
                    color: '#fff',
                    fontWeight: 600,
                }}
                title="En cours"
            >
                ⏳ En cours
            </span>
        );
    }
    return (
        <span
            style={{
                padding: '2px 6px',
                borderRadius: 3,
                fontSize: '0.85em',
                background: '#7f8c8d',
                color: '#fff',
                fontWeight: 600,
            }}
            title="Non résolue"
        >
            ○ Non résolue
        </span>
    );
}

