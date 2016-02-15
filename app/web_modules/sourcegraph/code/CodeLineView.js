import React from "react";

import classNames from "classnames";
import Component from "sourcegraph/Component";
import Dispatcher from "sourcegraph/Dispatcher";
import * as CodeActions from "sourcegraph/code/CodeActions";
import * as DefActions from "sourcegraph/def/DefActions";
import {GoTo} from "sourcegraph/util/hotLink";

class CodeLineView extends Component {
	constructor(props) {
		super(props);
		this.state = {
			ownAnnURLs: {},
		};
	}

	reconcileState(state, props) {
		// Update ownAnnURLs when they change.
		if (state.annotations !== props.annotations) {
			state.annotations = props.annotations;
			state.ownAnnURLs = {};
			if (state.annotations) {
				state.annotations.forEach((ann) => {
					if (ann.URL) state.ownAnnURLs[ann.URL] = true;
				});
			}
		}

		// Filter selectedDef and highlightedDef to improve perf.
		state.selectedDef = state.ownAnnURLs[props.selectedDef] ? props.selectedDef : null;
		state.highlightedDef = state.ownAnnURLs[props.highlightedDef] ? props.highlightedDef : null;

		state.lineNumber = props.lineNumber || null;
		state.startByte = props.startByte || null;
		state.contents = props.contents;
		state.selected = Boolean(props.selected);
	}

	render() {
		let contents;
		if (this.state.annotations) {
			contents = [];
			let pos = 0;
			let skip;
			this.state.annotations.forEach((ann, i) => {
				if (skip >= i) {
					// This annotation's class was already merged into a previous annotation.
					return;
				}

				let cls;
				let extraURLs;

				// Merge syntax highlighting and multiple-def annotations into the previous link, if any.
				for (let j = i + 1; j < this.state.annotations.length; j++) {
					let ann2 = this.state.annotations[j];
					if (ann2.StartByte === ann.StartByte && ann2.EndByte === ann.EndByte) {
						if (ann2.Class) {
							cls = cls || [];
							cls.push(ann2.Class);
						}
						if (ann2.URL) {
							extraURLs = extraURLs || [];
							extraURLs.push(ann2.URL);
						}
						skip = j;
					} else {
						break;
					}
				}

				const start = ann.StartByte - this.state.startByte;
				const end = ann.EndByte - this.state.startByte;
				if (start > pos) {
					contents.push(this.state.contents.slice(pos, start));
				}

				let matchesURL = (url) => ann.URL === url || (extraURLs && extraURLs.includes(url));

				const text = this.state.contents.slice(start, end);
				let el;
				if (ann.URL) {
					el = (
						<a
							className={classNames(cls, {
								"ref": true,
								"highlight-primary": matchesURL(this.state.selectedDef),
								"highlight-secondary": !matchesURL(this.state.selectedDef) && matchesURL(this.state.highlightedDef),
							})}
							href={ann.URL}
							onMouseOver={() => Dispatcher.dispatch(new DefActions.HighlightDef(ann.URL))}
							onMouseOut={() => Dispatcher.dispatch(new DefActions.HighlightDef(null))}
							onClick={(ev) => {
								if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
								ev.preventDefault();
								if (extraURLs) {
									Dispatcher.asyncDispatch(new DefActions.SelectMultipleDefs([ann.URL].concat(extraURLs), ev.view.scrollX + ev.clientX, ev.view.scrollY + ev.clientY)); // dispatch async so that the menu is not immediately closed by click handler on document
								} else {
									Dispatcher.dispatch(new GoTo(ann.URL));
								}
							}}
							key={i}>{text}</a>
					);
				} else {
					el = <span key={i} className={ann.Class}>{text}</span>;
				}
				contents.push(el);
				pos = end;
			});
			if (pos < this.state.contents.length) {
				contents.push(this.state.contents.slice(pos));
			}
		} else {
			contents = this.state.contents;
		}

		return (
			<tr className={`line ${this.state.selected ? "main-byte-range" : ""}`}>
				{this.state.lineNumber &&
					<td className="line-number"
						data-line={this.state.lineNumber}
						onClick={(event) => {
							if (event.shiftKey) {
								Dispatcher.dispatch(new CodeActions.SelectRange(this.state.lineNumber));
								return;
							}
							Dispatcher.dispatch(new CodeActions.SelectLine(this.state.lineNumber));
						}}>
					</td>}
				<td className="line-content">
					{contents}
					{this.state.contents === "" && <span>&nbsp;</span>}
				</td>
			</tr>
		);
	}
}

CodeLineView.propTypes = {
	lineNumber: React.PropTypes.number,
	startByte: React.PropTypes.number.isRequired,
	contents: React.PropTypes.string,
	annotations: React.PropTypes.array,
	selected: React.PropTypes.bool,
	selectedDef: React.PropTypes.string,
	highlightedDef: React.PropTypes.string,
};

export default CodeLineView;
