import { createRequire } from 'node:module';
import { eslintCompatPlugin } from '@oxlint/plugins';
import type { Context, ESTree, Rule } from '@oxlint/plugins';
import type { OxlintConfig } from 'oxlint';
import type { Candidate as NativeCandidate, Finding } from '../index.js';

const require = createRequire(import.meta.url);
type Candidate = NativeCandidate & { kind: 0 | 1 };
const { scan } = require('../index.js') as typeof import('../index.js');

type AstNode = ESTree.Node;
type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression;
type AddString = (text: string, node: AstNode) => void;
type FileState = {
  candidates: Candidate[];
  nodes: AstNode[];
  seenRoots: Set<number>;
  findings: Finding[] | null;
};

const CLASS_HELPERS = new Set(['clsx', 'cn', 'classnames', 'classNames', 'twMerge']);
const WRAPPERS = new Set(['memo', 'forwardRef']);
const fileStates = new WeakMap<ESTree.Program, FileState>();

function isUppercaseName(name: string | null | undefined): boolean {
  return typeof name === 'string' && /^[A-Z]/.test(name);
}

function namedMember(node: AstNode | null | undefined): string | null {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'MemberExpression' && !node.computed
    && node.property.type === 'Identifier') return node.property.name;
  return null;
}

function variableName(node: AstNode | null | undefined): string | null {
  return node?.type === 'VariableDeclarator' && node.id.type === 'Identifier'
    ? node.id.name : null;
}

function isWrapper(node: AstNode | null | undefined): boolean {
  const name = namedMember(node);
  return name !== null && WRAPPERS.has(name);
}

function isComponentFunction(node: FunctionNode): boolean {
  if (node.type === 'FunctionDeclaration') {
    return isUppercaseName(node.id?.name) || node.parent?.type === 'ExportDefaultDeclaration';
  }
  let parent = node.parent;
  if (isUppercaseName(variableName(parent))) return true;
  if (parent?.type === 'ExportDefaultDeclaration') return true;
  if (parent?.type === 'CallExpression' && isWrapper(parent.callee)) {
    while (parent?.type === 'CallExpression' && isWrapper(parent.callee)) {
      parent = parent.parent;
    }
    return isUppercaseName(variableName(parent))
      || parent?.type === 'ExportDefaultDeclaration';
  }
  if (parent?.type === 'MethodDefinition' && namedMember(parent.key) === 'render') {
    const owner = parent.parent;
    if (owner?.type !== 'ClassBody') return false;
    const cls = owner.parent;
    return ((cls?.type === 'ClassDeclaration' || cls?.type === 'ClassExpression')
        && isUppercaseName(cls.id?.name))
      || cls?.parent?.type === 'ExportDefaultDeclaration'
      || isUppercaseName(variableName(cls?.parent));
  }
  return false;
}

function nearestFunction(node: ESTree.ReturnStatement): FunctionNode | null {
  for (let parent: AstNode | null = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression'
      || parent.type === 'ArrowFunctionExpression') return parent;
  }
  return null;
}

function isFragmentElement(name: ESTree.JSXElementName): boolean {
  return (name.type === 'JSXIdentifier' && name.name === 'Fragment')
    || (name.type === 'JSXMemberExpression' && name.object.type === 'JSXIdentifier'
      && name.object.name === 'React'
      && name.property?.name === 'Fragment');
}

function visitReturned(node: AstNode | null | undefined,
  visitRoot: (opening: ESTree.JSXOpeningElement) => void): void {
  if (!node) return;
  switch (node.type) {
    case 'JSXElement':
      if (isFragmentElement(node.openingElement.name)) {
        for (const child of node.children) {
          if (child.type === 'JSXElement' || child.type === 'JSXFragment') visitReturned(child, visitRoot);
          if (child.type === 'JSXExpressionContainer') visitReturned(child.expression, visitRoot);
        }
      } else {
        visitRoot(node.openingElement);
      }
      break;
    case 'JSXFragment':
      for (const child of node.children) {
        if (child.type === 'JSXElement' || child.type === 'JSXFragment') visitReturned(child, visitRoot);
        if (child.type === 'JSXExpressionContainer') visitReturned(child.expression, visitRoot);
      }
      break;
    case 'ConditionalExpression':
      visitReturned(node.consequent, visitRoot);
      visitReturned(node.alternate, visitRoot);
      break;
    case 'LogicalExpression':
      visitReturned(node.right, visitRoot);
      break;
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      visitReturned(node.expression, visitRoot);
      break;
    case 'SequenceExpression':
      visitReturned(node.expressions.at(-1), visitRoot);
      break;
    case 'ArrayExpression':
      for (const element of node.elements) visitReturned(element, visitRoot);
      break;
    default:
      break;
  }
}

function staticStrings(node: AstNode | null | undefined, add: AddString): void {
  if (!node) return;
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string') add(node.value, node);
      break;
    case 'TemplateLiteral':
      for (const quasi of node.quasis) add(quasi.value.cooked ?? quasi.value.raw, quasi);
      for (const expression of node.expressions) staticStrings(expression, add);
      break;
    case 'ConditionalExpression':
      staticStrings(node.consequent, add);
      staticStrings(node.alternate, add);
      break;
    case 'LogicalExpression':
      staticStrings(node.left, add);
      staticStrings(node.right, add);
      break;
    case 'ArrayExpression':
      for (const element of node.elements) staticStrings(element, add);
      break;
    case 'CallExpression':
      const helper = namedMember(node.callee);
      if (helper !== null && CLASS_HELPERS.has(helper)) {
        for (const argument of node.arguments) staticStrings(argument, add);
      }
      break;
    case 'ObjectExpression':
      for (const property of node.properties) {
        if (property.type !== 'Property') continue;
        if (property.value?.type === 'Literal' && !property.value.value) continue;
        if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
          add(property.key.value, property.key);
        } else if (property.key.type === 'Identifier' && !property.computed) {
          add(property.key.name, property.key);
        }
      }
      break;
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      staticStrings(node.expression, add);
      break;
    default:
      break;
  }
}

function staticValue(node: AstNode | null | undefined): string {
  if (node?.type === 'Literal') return String(node.value);
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? '';
  }
  return '';
}

function propertyName(node: ESTree.PropertyKey): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

function createRule(group: number, description: string): Rule {
  return {
    meta: {
      type: 'problem',
      docs: { description },
      schema: [],
      messages: {
        externalPlacement: "React component root must not set '{{value}}'; set it at the call site instead.",
      },
    },
    createOnce(context: Context) {
      let state: FileState = { candidates: [], nodes: [], seenRoots: new Set(), findings: null };
      let ownsCollection = false;

      function add(kind: Candidate['kind'], text: string, node: AstNode): void {
        if (!text) return;
        state.candidates.push({ kind, text });
        state.nodes.push(node);
      }

      function inspectRoot(opening: ESTree.JSXOpeningElement): void {
        const key = opening.start;
        if (state.seenRoots.has(key)) return;
        state.seenRoots.add(key);
        for (const attribute of opening.attributes) {
          if (attribute.type !== 'JSXAttribute') continue;
          const name = attribute.name?.name;
          if (name === 'className' || name === 'class') {
            const value = attribute.value;
            if (value?.type === 'Literal' && typeof value.value === 'string') {
              add(0, value.value, value);
            }
            else if (value?.type === 'JSXExpressionContainer') {
              staticStrings(value.expression, (text, node) => add(0, text, node));
            }
          } else if (name === 'style' && attribute.value?.type === 'JSXExpressionContainer') {
            const style = attribute.value.expression;
            if (style.type !== 'ObjectExpression') continue;
            for (const property of style.properties) {
              if (property.type !== 'Property') continue;
              const propertyText = propertyName(property.key);
              if (propertyText) add(1, `${propertyText}:${staticValue(property.value)}`, property.key);
            }
          }
        }
      }

      return {
        Program(node) {
          const existing = fileStates.get(node);
          if (existing) {
            state = existing;
          } else {
            fileStates.set(node, state);
            ownsCollection = true;
          }
        },
        ReturnStatement(node) {
          if (!ownsCollection) return;
          const fn = nearestFunction(node);
          if (fn && isComponentFunction(fn)) visitReturned(node.argument, inspectRoot);
        },
        ArrowFunctionExpression(node) {
          if (!ownsCollection) return;
          if (node.body.type !== 'BlockStatement' && isComponentFunction(node)) {
            visitReturned(node.body, inspectRoot);
          }
        },
        'Program:exit'() {
          if (state.candidates.length === 0) return;
          state.findings ??= scan(state.candidates);
          for (const finding of state.findings) {
            if (finding.group !== group) continue;
            const node = state.nodes[finding.index];
            if (!node) continue;
            context.report({
              node,
              messageId: 'externalPlacement',
              data: { value: finding.value },
            });
          }
        },
      };
    },
  };
}

// Numeric group IDs match the constants in src/lib.rs.
const rules = {
  'no-margin': createRule(0, 'Disallow margins on a React component root'),
  'no-position': createRule(1, 'Disallow non-static positioning on a React component root'),
  'no-offset': createRule(2, 'Disallow positioning offsets on a React component root'),
  'no-float': createRule(3, 'Disallow floats on a React component root'),
  'no-width': createRule(4, 'Disallow width on a React component root'),
  'no-flex-basis': createRule(5, 'Disallow flex basis on a React component root'),
} satisfies Record<string, Rule>;

export const recommended = {
  jsPlugins: [{ name: 'tw-no-self-positioning', specifier: import.meta.url }],
  rules: {
    'tw-no-self-positioning/no-margin': 'error',
    'tw-no-self-positioning/no-position': 'error',
    'tw-no-self-positioning/no-offset': 'error',
    'tw-no-self-positioning/no-float': 'error',
    'tw-no-self-positioning/no-width': 'error',
    'tw-no-self-positioning/no-flex-basis': 'error',
  } satisfies Record<`tw-no-self-positioning/${keyof typeof rules}`, 'error'>,
} satisfies OxlintConfig;

export const noSelfPositioning = Object.assign(
  eslintCompatPlugin({ meta: { name: 'tw-no-self-positioning' }, rules }),
  { rules, recommended },
);

export default noSelfPositioning;
