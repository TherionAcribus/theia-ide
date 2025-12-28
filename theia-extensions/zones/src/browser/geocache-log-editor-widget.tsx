import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';

type LogTypeValue = 'found' | 'dnf' | 'note';

interface GeocacheListItem {
    id: number;
    gc_code: string;
    name: string;
    favorites_count?: number;
    logs_count?: number;
}

@injectable()
export class GeocacheLogEditorWidget extends ReactWidget {
    static readonly ID = 'geocache.logEditor.widget';

    protected backendBaseUrl = 'http://127.0.0.1:8000';

    protected geocacheIds: number[] = [];
    protected geocaches: GeocacheListItem[] = [];
    protected isLoading = false;

    protected logDate = new Date().toISOString().slice(0, 10);
    protected logType: LogTypeValue = 'found';

    protected useSameTextForAll = true;
    protected globalText = '';
    protected perCacheText: Record<number, string> = {};
    protected perCacheFavorite: Record<number, boolean> = {};

    protected isSubmitting = false;
    protected lastSubmitSummary: { ok: number; failed: number } | undefined;

    protected globalTextArea: HTMLTextAreaElement | null = null;
    protected perCacheTextAreas: Record<number, HTMLTextAreaElement | null> = {};
    protected activeEditor: { type: 'global' } | { type: 'per-cache'; geocacheId: number } | undefined;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService
    ) {
        super();
        this.title.label = 'Logs';
        this.title.caption = 'Édition de logs';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-pen';
        this.addClass('theia-geocache-log-editor-widget');
    }

    protected escapeHtml(value: string): string {
        return (value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    protected sanitizeUrl(url: string): string | undefined {
        const trimmed = (url || '').trim();
        if (!trimmed) {
            return undefined;
        }
        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }
        return undefined;
    }

    protected renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
        const nodes: React.ReactNode[] = [];
        let remaining = text || '';
        let idx = 0;

        const pushText = (t: string) => {
            if (t) {
                nodes.push(<React.Fragment key={`${keyPrefix}-t-${idx++}`}>{t}</React.Fragment>);
            }
        };

        while (remaining.length > 0) {
            const candidates: Array<{ kind: 'code' | 'bold' | 'italic' | 'link'; pos: number }> = [];
            const codePos = remaining.indexOf('`');
            if (codePos >= 0) candidates.push({ kind: 'code', pos: codePos });
            const boldPos = remaining.indexOf('**');
            if (boldPos >= 0) candidates.push({ kind: 'bold', pos: boldPos });
            const italicPos = remaining.indexOf('*');
            if (italicPos >= 0) candidates.push({ kind: 'italic', pos: italicPos });
            const linkPos = remaining.indexOf('[');
            if (linkPos >= 0) candidates.push({ kind: 'link', pos: linkPos });

            if (candidates.length === 0) {
                pushText(remaining);
                break;
            }

            candidates.sort((a, b) => a.pos - b.pos);
            const next = candidates[0];
            if (next.pos > 0) {
                pushText(remaining.slice(0, next.pos));
                remaining = remaining.slice(next.pos);
            }

            if (next.kind === 'code' && remaining.startsWith('`')) {
                const end = remaining.indexOf('`', 1);
                if (end > 0) {
                    const content = remaining.slice(1, end);
                    nodes.push(<code key={`${keyPrefix}-c-${idx++}`}>{content}</code>);
                    remaining = remaining.slice(end + 1);
                    continue;
                }
            }

            if (next.kind === 'bold' && remaining.startsWith('**')) {
                const end = remaining.indexOf('**', 2);
                if (end > 1) {
                    const content = remaining.slice(2, end);
                    nodes.push(<strong key={`${keyPrefix}-b-${idx++}`}>{content}</strong>);
                    remaining = remaining.slice(end + 2);
                    continue;
                }
            }

            if (next.kind === 'italic' && remaining.startsWith('*') && !remaining.startsWith('**')) {
                const end = remaining.indexOf('*', 1);
                if (end > 0) {
                    const content = remaining.slice(1, end);
                    nodes.push(<em key={`${keyPrefix}-i-${idx++}`}>{content}</em>);
                    remaining = remaining.slice(end + 1);
                    continue;
                }
            }

            if (next.kind === 'link' && remaining.startsWith('[')) {
                const closeBracket = remaining.indexOf(']');
                if (closeBracket > 0 && remaining[closeBracket + 1] === '(') {
                    const closeParen = remaining.indexOf(')', closeBracket + 2);
                    if (closeParen > closeBracket + 2) {
                        const label = remaining.slice(1, closeBracket);
                        const url = remaining.slice(closeBracket + 2, closeParen);
                        const safeUrl = this.sanitizeUrl(url);
                        if (safeUrl) {
                            nodes.push(
                                <a
                                    key={`${keyPrefix}-l-${idx++}`}
                                    href={safeUrl}
                                    target='_blank'
                                    rel='noreferrer'
                                    style={{ color: 'var(--theia-textLink-foreground)' }}
                                >
                                    {label}
                                </a>
                            );
                        } else {
                            nodes.push(<React.Fragment key={`${keyPrefix}-l-${idx++}`}>{label} ({url})</React.Fragment>);
                        }
                        remaining = remaining.slice(closeParen + 1);
                        continue;
                    }
                }
            }

            pushText(remaining.slice(0, 1));
            remaining = remaining.slice(1);
        }

        return nodes;
    }

    protected renderMarkdown(text: string, keyPrefix: string): React.ReactNode {
        const lines = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const blocks: React.ReactNode[] = [];
        let i = 0;

        const pushParagraph = (paragraphLines: string[], key: string) => {
            const joined = paragraphLines.join('\n');
            const parts = joined.split('\n');
            blocks.push(
                <p key={key} style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>
                    {parts.map((p, pi) => (
                        <React.Fragment key={`${key}-p-${pi}`}>
                            {this.renderInlineMarkdown(p, `${key}-in-${pi}`)}
                            {pi < parts.length - 1 ? <br /> : null}
                        </React.Fragment>
                    ))}
                </p>
            );
        };

        while (i < lines.length) {
            const raw = lines[i];
            const line = raw ?? '';

            if (/^```/.test(line.trim())) {
                const start = i;
                i += 1;
                const codeLines: string[] = [];
                while (i < lines.length && !/^```/.test((lines[i] ?? '').trim())) {
                    codeLines.push(lines[i] ?? '');
                    i += 1;
                }
                if (i < lines.length) {
                    i += 1;
                }
                const code = codeLines.join('\n');
                blocks.push(
                    <pre
                        key={`${keyPrefix}-code-${start}`}
                        style={{
                            margin: '8px 0',
                            padding: 10,
                            borderRadius: 6,
                            border: '1px solid var(--theia-panel-border)',
                            background: 'var(--theia-editor-background)',
                            overflow: 'auto',
                            fontSize: 12,
                        }}
                    >
                        <code>{code}</code>
                    </pre>
                );
                continue;
            }

            const hMatch = /^(#{1,3})\s+(.*)$/.exec(line);
            if (hMatch) {
                const level = hMatch[1].length;
                const content = hMatch[2] || '';
                const Tag = (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as any;
                blocks.push(
                    <Tag key={`${keyPrefix}-h-${i}`} style={{ margin: '10px 0 6px 0' }}>
                        {this.renderInlineMarkdown(content, `${keyPrefix}-h-in-${i}`)}
                    </Tag>
                );
                i += 1;
                continue;
            }

            if (/^>\s+/.test(line)) {
                const quoteLines: string[] = [];
                const start = i;
                while (i < lines.length && /^>\s+/.test(lines[i] ?? '')) {
                    quoteLines.push((lines[i] ?? '').replace(/^>\s+/, ''));
                    i += 1;
                }
                blocks.push(
                    <blockquote
                        key={`${keyPrefix}-q-${start}`}
                        style={{
                            margin: '8px 0',
                            paddingLeft: 10,
                            borderLeft: '3px solid var(--theia-panel-border)',
                            opacity: 0.9,
                        }}
                    >
                        {this.renderMarkdown(quoteLines.join('\n'), `${keyPrefix}-q-inner-${start}`)}
                    </blockquote>
                );
                continue;
            }

            if (/^\s*[-*]\s+/.test(line)) {
                const items: string[] = [];
                const start = i;
                while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
                    items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''));
                    i += 1;
                }
                blocks.push(
                    <ul key={`${keyPrefix}-ul-${start}`} style={{ margin: '6px 0 6px 20px' }}>
                        {items.map((it, ii) => (
                            <li key={`${keyPrefix}-ul-${start}-${ii}`}>
                                {this.renderInlineMarkdown(it, `${keyPrefix}-ul-in-${start}-${ii}`)}
                            </li>
                        ))}
                    </ul>
                );
                continue;
            }

            if (!line.trim()) {
                i += 1;
                continue;
            }

            const paragraphLines: string[] = [];
            const start = i;
            while (
                i < lines.length &&
                (lines[i] ?? '').trim() &&
                !/^(#{1,3})\s+/.test(lines[i] ?? '') &&
                !/^```/.test((lines[i] ?? '').trim()) &&
                !/^>\s+/.test(lines[i] ?? '') &&
                !/^\s*[-*]\s+/.test(lines[i] ?? '')
            ) {
                paragraphLines.push(lines[i] ?? '');
                i += 1;
            }
            pushParagraph(paragraphLines, `${keyPrefix}-p-${start}`);
        }

        return <div style={{ display: 'grid', gap: 4 }}>{blocks}</div>;
    }

    protected applyEditorValue(editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number }, nextValue: string): void {
        if (editor.type === 'global') {
            this.globalText = nextValue;
        } else {
            this.perCacheText = { ...this.perCacheText, [editor.geocacheId]: nextValue };
        }
    }

    protected getEditorValue(editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number }): string {
        return editor.type === 'global' ? this.globalText : (this.perCacheText[editor.geocacheId] ?? '');
    }

    protected getEditorTextArea(editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number }): HTMLTextAreaElement | null {
        return editor.type === 'global' ? this.globalTextArea : (this.perCacheTextAreas[editor.geocacheId] ?? null);
    }

    protected applyMarkdownWrap(before: string, after: string, placeholder: string): void {
        const editor = this.activeEditor;
        if (!editor) {
            this.messages.warn('Clique dans une zone de texte pour appliquer le Markdown.');
            return;
        }

        const ta = this.getEditorTextArea(editor);
        const value = this.getEditorValue(editor);
        const start = ta ? ta.selectionStart : value.length;
        const end = ta ? ta.selectionEnd : value.length;
        const hasSelection = start !== end;
        const selected = value.slice(start, end);
        const insert = hasSelection ? selected : placeholder;
        const nextValue = value.slice(0, start) + before + insert + after + value.slice(end);

        this.applyEditorValue(editor, nextValue);
        this.update();

        setTimeout(() => {
            const nextTa = this.getEditorTextArea(editor);
            if (!nextTa) {
                return;
            }
            nextTa.focus();
            if (!hasSelection) {
                const selStart = start + before.length;
                nextTa.setSelectionRange(selStart, selStart + insert.length);
            } else {
                const selStart = start + before.length;
                const selEnd = selStart + insert.length;
                nextTa.setSelectionRange(selStart, selEnd);
            }
        }, 0);
    }

    protected applyMarkdownPrefix(prefix: string, placeholder: string): void {
        const editor = this.activeEditor;
        if (!editor) {
            this.messages.warn('Clique dans une zone de texte pour appliquer le Markdown.');
            return;
        }

        const ta = this.getEditorTextArea(editor);
        const value = this.getEditorValue(editor);
        const start = ta ? ta.selectionStart : value.length;
        const end = ta ? ta.selectionEnd : value.length;

        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', end);
        const safeLineEnd = lineEnd === -1 ? value.length : lineEnd;

        const selectedBlock = value.slice(lineStart, safeLineEnd);
        const isEmpty = !selectedBlock.trim();
        const toProcess = isEmpty ? placeholder : selectedBlock;

        const processed = toProcess
            .split('\n')
            .map(l => (l.trim() ? `${prefix}${l}` : l))
            .join('\n');

        const nextValue = value.slice(0, lineStart) + processed + value.slice(safeLineEnd);
        this.applyEditorValue(editor, nextValue);
        this.update();

        setTimeout(() => {
            const nextTa = this.getEditorTextArea(editor);
            if (!nextTa) {
                return;
            }
            nextTa.focus();
            const selStart = lineStart + prefix.length;
            if (isEmpty) {
                nextTa.setSelectionRange(selStart, selStart + placeholder.length);
            } else {
                nextTa.setSelectionRange(lineStart, lineStart + processed.length);
            }
        }, 0);
    }

    setContext(params: { geocacheIds: number[]; title?: string }): void {
        const ids = (params.geocacheIds || []).filter((v): v is number => typeof v === 'number');
        this.geocacheIds = Array.from(new Set(ids));
        this.geocaches = [];
        this.perCacheText = {};
        this.perCacheFavorite = {};

        if (params.title) {
            this.title.label = params.title;
        } else if (this.geocacheIds.length === 1) {
            this.title.label = 'Log - 1 géocache';
        } else {
            this.title.label = `Log - ${this.geocacheIds.length} géocaches`;
        }

        void this.loadGeocaches();
        this.update();
    }

    protected async loadGeocaches(): Promise<void> {
        if (!this.geocacheIds.length || this.isLoading) {
            return;
        }

        this.isLoading = true;
        this.update();

        try {
            const results = await Promise.all(this.geocacheIds.map(async (id) => {
                const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${id}`, { credentials: 'include' });
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = await res.json();
                return {
                    id: data.id as number,
                    gc_code: (data.gc_code || '').toString(),
                    name: (data.name || '').toString(),
                    favorites_count: typeof data.favorites_count === 'number' ? (data.favorites_count as number) : undefined,
                    logs_count: typeof data.logs_count === 'number' ? (data.logs_count as number) : undefined,
                } as GeocacheListItem;
            }));

            this.geocaches = results;

            const nextFav: Record<number, boolean> = { ...this.perCacheFavorite };
            for (const gc of results) {
                if (typeof nextFav[gc.id] !== 'boolean') {
                    nextFav[gc.id] = false;
                }
            }
            this.perCacheFavorite = nextFav;
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] loadGeocaches error', e);
            this.messages.error('Impossible de charger la liste des géocaches.');
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected formatFavoritePercent(favoritesCount: number | undefined, logsCount: number | undefined): string {
        if (typeof favoritesCount !== 'number' || typeof logsCount !== 'number' || logsCount <= 0) {
            return '—';
        }
        const pct = (favoritesCount / logsCount) * 100;
        if (!isFinite(pct)) {
            return '—';
        }
        return `${pct.toFixed(1)}%`;
    }

    protected toggleFavoriteForGeocacheId(geocacheId: number, nextValue: boolean): void {
        this.perCacheFavorite = { ...this.perCacheFavorite, [geocacheId]: nextValue };
        this.update();
    }

    protected getTextForGeocacheId(geocacheId: number): string {
        return this.useSameTextForAll ? this.globalText : (this.perCacheText[geocacheId] ?? '');
    }

    protected async submitLogsToGeocaching(): Promise<void> {
        if (this.isSubmitting) {
            return;
        }
        if (this.isLoading || this.geocaches.length === 0) {
            this.messages.warn('Aucune géocache à loguer.');
            return;
        }

        const missingText = this.geocaches
            .map(gc => ({ gc, text: (this.getTextForGeocacheId(gc.id) || '').trim() }))
            .filter(x => !x.text);

        if (missingText.length > 0) {
            if (this.useSameTextForAll) {
                this.messages.warn('Le texte du log est vide.');
            } else {
                this.messages.warn(`Texte manquant pour ${missingText.length} géocache(s).`);
            }
            return;
        }

        this.isSubmitting = true;
        this.lastSubmitSummary = undefined;
        this.update();

        let ok = 0;
        let failed = 0;

        try {
            for (const gc of this.geocaches) {
                const payload = {
                    text: this.getTextForGeocacheId(gc.id),
                    date: this.logDate,
                    logType: this.logType,
                    favorite: this.logType === 'found' ? (this.perCacheFavorite[gc.id] === true) : false,
                };

                let responseBody: any = undefined;
                try {
                    const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${gc.id}/logs/submit`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(payload),
                    });

                    try {
                        responseBody = await res.json();
                    } catch {
                        responseBody = undefined;
                    }

                    if (res.ok) {
                        ok += 1;
                    } else {
                        failed += 1;
                        const detail = responseBody?.error ? `: ${responseBody.error}` : '';
                        this.messages.warn(`${gc.gc_code} - échec${detail}`);
                    }
                } catch (e) {
                    console.error('[GeocacheLogEditorWidget] submit log error', gc, e, responseBody);
                    failed += 1;
                    this.messages.warn(`${gc.gc_code} - erreur réseau/backend`);
                }
            }

            this.lastSubmitSummary = { ok, failed };
            if (failed === 0) {
                this.messages.info(`Logs envoyés sur Geocaching.com: ${ok}/${ok}`);
            } else {
                this.messages.warn(`Logs envoyés sur Geocaching.com: ${ok} ok, ${failed} échec(s)`);
            }
        } finally {
            this.isSubmitting = false;
            this.update();
        }
    }

    protected formatVisitedIso(dateOnly: string): string {
        const safe = (dateOnly || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(safe)) {
            return `${new Date().toISOString().slice(0, 10)}T12:00Z`;
        }
        return `${safe}T12:00Z`;
    }

    protected getLogTypeLabel(value: LogTypeValue): string {
        if (value === 'found') {
            return 'Found it';
        }
        if (value === 'dnf') {
            return "Didn't find it";
        }
        return 'Write note';
    }

    protected escapeFieldNotesText(value: string): string {
        return (value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/"/g, '""');
    }

    protected buildFieldNotes(): string {
        const visited = this.formatVisitedIso(this.logDate);
        const logType = this.getLogTypeLabel(this.logType);

        const lines = this.geocaches.map(gc => {
            const rawText = this.useSameTextForAll ? this.globalText : (this.perCacheText[gc.id] ?? '');
            const escaped = this.escapeFieldNotesText(rawText);
            return `${gc.gc_code},${visited},${logType},"${escaped}"`;
        });

        return lines.join('\n');
    }

    protected async copyFieldNotes(): Promise<void> {
        try {
            const content = this.buildFieldNotes();
            await navigator.clipboard.writeText(content);
            this.messages.info('Field notes copiées dans le presse-papiers.');
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] copyFieldNotes error', e);
            this.messages.error('Impossible de copier dans le presse-papiers.');
        }
    }

    protected downloadFieldNotes(): void {
        try {
            const content = this.buildFieldNotes();
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'geocache_visits.txt';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] downloadFieldNotes error', e);
            this.messages.error('Impossible de télécharger le fichier.');
        }
    }

    protected render(): React.ReactNode {
        return (
            <div style={{ padding: 12, height: '100%', overflow: 'auto', display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ display: 'grid', gap: 8 }}>
                        <div>
                            <h3 style={{ margin: 0 }}>Logs</h3>
                            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
                                {this.geocacheIds.length} géocache(s)
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                            className='theia-button primary'
                            onClick={() => { void this.submitLogsToGeocaching(); }}
                            disabled={this.isLoading || this.isSubmitting || this.geocaches.length === 0}
                            title='Envoyer le(s) log(s) sur Geocaching.com via le backend'
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            ✅ Envoyer sur GC
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => { void this.copyFieldNotes(); }}
                            disabled={this.isLoading || this.geocaches.length === 0}
                            title='Copier le format geocache_visits.txt (field notes)'
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            📋 Copier field notes
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => this.downloadFieldNotes()}
                            disabled={this.isLoading || this.geocaches.length === 0}
                            title='Télécharger un fichier geocache_visits.txt'
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            ⬇️ Télécharger
                        </button>
                    </div>
                </div>

                {this.useSameTextForAll && this.geocaches.length === 1 && this.geocaches[0] && (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>
                            PF: {typeof this.geocaches[0].favorites_count === 'number' ? this.geocaches[0].favorites_count : '—'}
                            {'  '}(
                            {this.formatFavoritePercent(this.geocaches[0].favorites_count, this.geocaches[0].logs_count)}
                            )
                        </div>
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, opacity: this.logType === 'found' ? 0.9 : 0.5 }}>
                            <input
                                type='checkbox'
                                checked={this.perCacheFavorite[this.geocaches[0].id] === true}
                                onChange={e => this.toggleFavoriteForGeocacheId(this.geocaches[0].id, e.target.checked)}
                                disabled={this.logType !== 'found'}
                            />
                            Donner un PF
                        </label>
                    </div>
                )}

                {this.geocaches.length > 1 && (
                    <div style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ padding: '8px 10px', fontWeight: 600, background: 'var(--theia-editor-background)' }}>
                            Points favoris (PF)
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                                <tr style={{ background: 'var(--theia-editor-background)' }}>
                                    <th style={{ textAlign: 'left', padding: '6px 10px', borderTop: '1px solid var(--theia-panel-border)' }}>GC</th>
                                    <th style={{ textAlign: 'left', padding: '6px 10px', borderTop: '1px solid var(--theia-panel-border)' }}>Nom</th>
                                    <th style={{ textAlign: 'right', padding: '6px 10px', borderTop: '1px solid var(--theia-panel-border)' }}>PF</th>
                                    <th style={{ textAlign: 'right', padding: '6px 10px', borderTop: '1px solid var(--theia-panel-border)' }}>%</th>
                                    <th style={{ textAlign: 'center', padding: '6px 10px', borderTop: '1px solid var(--theia-panel-border)' }}>Donner PF</th>
                                </tr>
                            </thead>
                            <tbody>
                                {this.geocaches.map(gc => (
                                    <tr key={`fav-${gc.id}`} style={{ borderTop: '1px solid var(--theia-panel-border)' }}>
                                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', fontWeight: 700 }}>{gc.gc_code}</td>
                                        <td style={{ padding: '6px 10px' }}>{gc.name}</td>
                                        <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            {typeof gc.favorites_count === 'number' ? gc.favorites_count : '—'}
                                        </td>
                                        <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            {this.formatFavoritePercent(gc.favorites_count, gc.logs_count)}
                                        </td>
                                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                            <input
                                                type='checkbox'
                                                checked={this.perCacheFavorite[gc.id] === true}
                                                onChange={e => this.toggleFavoriteForGeocacheId(gc.id, e.target.checked)}
                                                disabled={this.logType !== 'found'}
                                                title={this.logType !== 'found' ? 'Le PF est disponible uniquement pour un log Found it' : 'Donner un point favori'}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {this.lastSubmitSummary && (
                    <div style={{ opacity: 0.85, fontSize: 12 }}>
                        Résultat: {this.lastSubmitSummary.ok} ok, {this.lastSubmitSummary.failed} échec(s)
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '160px 220px 1fr', gap: 12, alignItems: 'end' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Date</label>
                        <input
                            type='date'
                            className='theia-input'
                            value={this.logDate}
                            onChange={e => { this.logDate = e.target.value; this.update(); }}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Type</label>
                        <select
                            className='theia-select'
                            value={this.logType}
                            onChange={e => { this.logType = e.target.value as LogTypeValue; this.update(); }}
                            style={{ width: '100%' }}
                        >
                            <option value='found'>Found it</option>
                            <option value='dnf'>Didn't find it</option>
                            <option value='note'>Write note</option>
                        </select>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                            type='checkbox'
                            checked={this.useSameTextForAll}
                            onChange={e => { this.useSameTextForAll = e.target.checked; this.update(); }}
                        />
                        <span style={{ fontSize: 12, opacity: 0.85 }}>Texte identique pour toutes les géocaches</span>
                    </div>
                </div>

                {this.useSameTextForAll && (
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Texte (Markdown)</label>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, opacity: 0.75, marginRight: 6 }}>Markdown</span>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('**', '**', 'texte')} disabled={this.isLoading || this.isSubmitting} title='Gras'>
                                <strong>B</strong>
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('*', '*', 'texte')} disabled={this.isLoading || this.isSubmitting} title='Italique'>
                                <em>I</em>
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('`', '`', 'code')} disabled={this.isLoading || this.isSubmitting} title='Code inline'>
                                {'</>'}
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('[', '](https://example.com)', 'lien')} disabled={this.isLoading || this.isSubmitting} title='Lien'>
                                🔗
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('# ', 'Titre')} disabled={this.isLoading || this.isSubmitting} title='Titre'>
                                H1
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('## ', 'Sous-titre')} disabled={this.isLoading || this.isSubmitting} title='Sous-titre'>
                                H2
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('- ', 'item')} disabled={this.isLoading || this.isSubmitting} title='Liste'>
                                -
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('> ', 'Citation')} disabled={this.isLoading || this.isSubmitting} title='Citation'>
                                &gt;
                            </button>
                        </div>
                        <textarea
                            className='theia-input'
                            value={this.globalText}
                            onChange={e => { this.globalText = e.target.value; this.update(); }}
                            onFocus={() => { this.activeEditor = { type: 'global' }; }}
                            ref={el => { this.globalTextArea = el; }}
                            rows={10}
                            style={{ width: '100%', resize: 'vertical' }}
                        />

                        <details style={{ marginTop: 8 }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Aperçu Markdown</summary>
                            <div style={{ marginTop: 8, background: 'var(--theia-editor-background)', border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 10, fontSize: 13, overflow: 'auto' }}>
                                {this.renderMarkdown(this.globalText, 'global-preview')}
                            </div>
                        </details>
                    </div>
                )}

                {this.isLoading && (
                    <div style={{ opacity: 0.7 }}>
                        Chargement…
                    </div>
                )}

                {!this.isLoading && this.geocaches.length === 0 && (
                    <div style={{ opacity: 0.7 }}>
                        Aucune géocache
                    </div>
                )}

                {!this.isLoading && this.geocaches.length > 0 && !this.useSameTextForAll && (
                    <div style={{ display: 'grid', gap: 10 }}>
                        {this.geocaches.map(gc => (
                            <div key={gc.id} style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 10, background: 'var(--theia-editor-background)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                                    <div style={{ fontWeight: 700 }}>{gc.gc_code}</div>
                                    <div style={{ opacity: 0.8, fontSize: 12, textAlign: 'right' }}>{gc.name}</div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                                        PF: {typeof gc.favorites_count === 'number' ? gc.favorites_count : '—'}
                                        {'  '}(
                                        {this.formatFavoritePercent(gc.favorites_count, gc.logs_count)}
                                        )
                                    </div>
                                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, opacity: this.logType === 'found' ? 0.9 : 0.5 }}>
                                        <input
                                            type='checkbox'
                                            checked={this.perCacheFavorite[gc.id] === true}
                                            onChange={e => this.toggleFavoriteForGeocacheId(gc.id, e.target.checked)}
                                            disabled={this.logType !== 'found'}
                                        />
                                        Donner un PF
                                    </label>
                                </div>

                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, marginBottom: 6 }}>
                                    <span style={{ fontSize: 12, opacity: 0.75, marginRight: 6 }}>Markdown</span>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('**', '**', 'texte')} disabled={this.isLoading || this.isSubmitting} title='Gras'>
                                        <strong>B</strong>
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('*', '*', 'texte')} disabled={this.isLoading || this.isSubmitting} title='Italique'>
                                        <em>I</em>
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('`', '`', 'code')} disabled={this.isLoading || this.isSubmitting} title='Code inline'>
                                        {'</>'}
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('[', '](https://example.com)', 'lien')} disabled={this.isLoading || this.isSubmitting} title='Lien'>
                                        🔗
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('# ', 'Titre')} disabled={this.isLoading || this.isSubmitting} title='Titre'>
                                        H1
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('## ', 'Sous-titre')} disabled={this.isLoading || this.isSubmitting} title='Sous-titre'>
                                        H2
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('- ', 'item')} disabled={this.isLoading || this.isSubmitting} title='Liste'>
                                        -
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('> ', 'Citation')} disabled={this.isLoading || this.isSubmitting} title='Citation'>
                                        &gt;
                                    </button>
                                </div>
                                <textarea
                                    className='theia-input'
                                    value={this.perCacheText[gc.id] ?? ''}
                                    onChange={e => {
                                        this.perCacheText = { ...this.perCacheText, [gc.id]: e.target.value };
                                        this.update();
                                    }}
                                    onFocus={() => { this.activeEditor = { type: 'per-cache', geocacheId: gc.id }; }}
                                    ref={el => { this.perCacheTextAreas = { ...this.perCacheTextAreas, [gc.id]: el }; }}
                                    rows={6}
                                    style={{ width: '100%', resize: 'vertical', marginTop: 8 }}
                                    placeholder='Texte (Markdown)'
                                />

                                <details style={{ marginTop: 8 }}>
                                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Aperçu Markdown</summary>
                                    <div style={{ marginTop: 8, background: 'var(--theia-editor-background)', border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 10, fontSize: 13, overflow: 'auto' }}>
                                        {this.renderMarkdown(this.perCacheText[gc.id] ?? '', `per-preview-${gc.id}`)}
                                    </div>
                                </details>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }
}
