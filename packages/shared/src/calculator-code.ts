import type { MathNode } from 'mathjs'
import { limitedParse } from './calculator-math'

/** Calculator expressions compiled to Python, JavaScript and Excel formulas (for exports and the schema check). */

export type Target = 'py' | 'js'

const FN_MAP: Record<Target, Record<string, string>> = {
  py: {
    sin: 'math.sin',
    cos: 'math.cos',
    tan: 'math.tan',
    asin: 'math.asin',
    acos: 'math.acos',
    atan: 'math.atan',
    atan2: 'math.atan2',
    sqrt: 'math.sqrt',
    exp: 'math.exp',
    log: 'math.log',
    log10: 'math.log10',
    abs: 'abs',
    floor: 'math.floor',
    ceil: 'math.ceil',
    min: 'min',
    max: 'max',
    round: 'round',
    sinh: 'math.sinh',
    cosh: 'math.cosh',
    tanh: 'math.tanh',
  },
  js: {
    sin: 'Math.sin',
    cos: 'Math.cos',
    tan: 'Math.tan',
    asin: 'Math.asin',
    acos: 'Math.acos',
    atan: 'Math.atan',
    atan2: 'Math.atan2',
    sqrt: 'Math.sqrt',
    exp: 'Math.exp',
    log: 'Math.log',
    log10: 'Math.log10',
    abs: 'Math.abs',
    floor: 'Math.floor',
    ceil: 'Math.ceil',
    min: 'Math.min',
    max: 'Math.max',
    round: 'Math.round',
    sinh: 'Math.sinh',
    cosh: 'Math.cosh',
    tanh: 'Math.tanh',
  },
}
const SYM_MAP: Record<Target, Record<string, string>> = {
  py: { pi: 'math.pi', e: 'math.e', deg: '(math.pi / 180)' },
  js: { pi: 'Math.PI', e: 'Math.E', deg: '(Math.PI / 180)' },
}

function compileNode(node: MathNode, target: Target, known: Set<string>): string {
  const n = node as MathNode & Record<string, unknown>
  switch (node.type) {
    case 'ConstantNode':
      if (typeof n.value === 'boolean') {
        if (target === 'py') return n.value ? 'True' : 'False'
        return n.value ? 'true' : 'false'
      }
      return String(n.value)
    case 'SymbolNode': {
      const name = n.name as string
      if (known.has(name)) return name
      const s = SYM_MAP[target][name]
      if (s) return s
      throw new Error(`Unknown symbol "${name}"`)
    }
    case 'ParenthesisNode':
      return `(${compileNode(n.content as MathNode, target, known)})`
    case 'OperatorNode': {
      const args = (n.args as MathNode[]).map((a) => compileNode(a, target, known))
      const fn = n.fn as string
      if (args.length === 1) {
        if (fn === 'unaryMinus') return `(-${args[0]})`
        if (fn === 'unaryPlus') return `(+${args[0]})`
        if (fn === 'factorial') throw new Error('factorial is not supported in export')
        if (fn === 'not') return target === 'py' ? `(not ${args[0]})` : `(!${args[0]})`
      }
      const op = n.op as string
      const mapped = op === '^' ? '**' : op === '.*' ? '*' : op === './' ? '/' : op
      if (args.length !== 2) throw new Error(`Operator "${op}" is not supported`)
      const operators: Record<Target, Record<string, string>> = {
        py: {
          '+': '+',
          '-': '-',
          '*': '*',
          '/': '/',
          '**': '**',
          '%': '%',
          '<': '<',
          '<=': '<=',
          '>': '>',
          '>=': '>=',
          '==': '==',
          '!=': '!=',
          and: 'and',
          or: 'or',
        },
        js: {
          '+': '+',
          '-': '-',
          '*': '*',
          '/': '/',
          '**': '**',
          '%': '%',
          '<': '<',
          '<=': '<=',
          '>': '>',
          '>=': '>=',
          '==': '===',
          '!=': '!==',
          and: '&&',
          or: '||',
        },
      }
      if (mapped === 'xor') {
        return target === 'py'
          ? `(bool(${args[0]}) != bool(${args[1]}))`
          : `(Boolean(${args[0]}) !== Boolean(${args[1]}))`
      }
      const exportOp = operators[target][mapped]
      if (!exportOp) throw new Error(`Operator "${op}" is not supported`)
      return `(${args[0]} ${exportOp} ${args[1]})`
    }
    case 'ConditionalNode': {
      const condition = compileNode(n.condition as MathNode, target, known)
      const trueExpr = compileNode(n.trueExpr as MathNode, target, known)
      const falseExpr = compileNode(n.falseExpr as MathNode, target, known)
      return target === 'py'
        ? `(${trueExpr} if ${condition} else ${falseExpr})`
        : `(${condition} ? ${trueExpr} : ${falseExpr})`
    }
    case 'FunctionNode': {
      const name = (n.fn as { name: string }).name
      const args = (n.args as MathNode[]).map((a) => compileNode(a, target, known))
      if (name === 'sign') {
        if (args.length !== 1) throw new Error('Function "sign" expects 1 argument')
        if (target === 'js') return `Math.sign(${args[0]})`
        return `(1 if ${args[0]} > 0 else (-1 if ${args[0]} < 0 else 0))`
      }
      if (name === 'log') {
        if (args.length < 1 || args.length > 2) throw new Error('Function "log" expects 1 or 2 arguments')
        if (args.length === 2 && target === 'js') return `(Math.log(${args[0]}) / Math.log(${args[1]}))`
      }
      if (name === 'round') {
        if (args.length < 1 || args.length > 2) throw new Error('Function "round" expects 1 or 2 arguments')
        const value = args[0]
        const factor = `10 ** ${args[1] ?? '0'}`
        return target === 'js'
          ? `(Math.sign(${value}) * Math.floor(Math.abs(${value}) * (${factor}) + 0.5) / (${factor}))`
          : `(math.copysign(math.floor(abs(${value}) * (${factor}) + 0.5) / (${factor}), ${value}))`
      }
      const f = FN_MAP[target][name]
      if (!f) throw new Error(`Function "${name}" is not supported in export`)
      if (['atan2'].includes(name) && args.length !== 2)
        throw new Error(`Function "${name}" expects 2 arguments`)
      if (['min', 'max'].includes(name) && args.length < 1)
        throw new Error(`Function "${name}" expects at least 1 argument`)
      if (!['atan2', 'log', 'min', 'max'].includes(name) && args.length !== 1)
        throw new Error(`Function "${name}" expects 1 argument`)
      return `${f}(${args.join(', ')})`
    }
    default:
      throw new Error(`Unsupported expression part: ${node.type}`)
  }
}

export function compileExpr(expr: string, target: Target, known: Set<string>): string {
  return compileNode(limitedParse(expr), target, known)
}

// ---------- Excel formulas ----------

const EXCEL_FN: Record<string, string> = {
  sin: 'SIN',
  cos: 'COS',
  tan: 'TAN',
  asin: 'ASIN',
  acos: 'ACOS',
  atan: 'ATAN',
  sqrt: 'SQRT',
  exp: 'EXP',
  log10: 'LOG10',
  abs: 'ABS',
  sign: 'SIGN',
  sinh: 'SINH',
  cosh: 'COSH',
  tanh: 'TANH',
}
const EXCEL_OP: Record<string, string> = {
  '+': '+',
  '-': '-',
  '*': '*',
  '/': '/',
  '^': '^',
  '.*': '*',
  './': '/',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  '==': '=',
  '!=': '<>',
}

function compileExcelNode(node: MathNode, ref: (key: string) => string | undefined): string {
  const n = node as MathNode & Record<string, unknown>
  const sub = (m: MathNode) => compileExcelNode(m, ref)
  switch (node.type) {
    case 'ConstantNode':
      if (typeof n.value === 'boolean') return n.value ? 'TRUE' : 'FALSE'
      return String(n.value)
    case 'SymbolNode': {
      const name = n.name as string
      const cell = ref(name)
      if (cell) return cell
      if (name === 'pi') return 'PI()'
      if (name === 'e') return 'EXP(1)'
      if (name === 'deg') return '(PI()/180)'
      throw new Error(`Unknown symbol "${name}"`)
    }
    case 'ParenthesisNode':
      return `(${sub(n.content as MathNode)})`
    case 'OperatorNode': {
      const args = (n.args as MathNode[]).map(sub)
      const fn = n.fn as string
      // Every operation is parenthesised: Excel's unary minus binds tighter than ^ (-2^2 is 4 in Excel).
      if (args.length === 1) {
        if (fn === 'unaryMinus') return `(-${args[0]})`
        if (fn === 'unaryPlus') return `(${args[0]})`
        if (fn === 'not') return `NOT(${args[0]})`
        throw new Error(`Operator "${n.op}" is not supported in Excel export`)
      }
      const op = n.op as string
      if (op === '%' || op === 'mod') return `MOD(${args[0]},${args[1]})`
      if (op === 'and') return `AND(${args[0]},${args[1]})`
      if (op === 'or') return `OR(${args[0]},${args[1]})`
      if (op === 'xor') return `XOR(${args[0]},${args[1]})`
      const mapped = EXCEL_OP[op]
      if (!mapped || args.length !== 2) throw new Error(`Operator "${op}" is not supported in Excel export`)
      return `(${args[0]}${mapped}${args[1]})`
    }
    case 'ConditionalNode':
      return `IF(${sub(n.condition as MathNode)},${sub(n.trueExpr as MathNode)},${sub(n.falseExpr as MathNode)})`
    case 'FunctionNode': {
      const name = (n.fn as { name: string }).name
      const args = (n.args as MathNode[]).map(sub)
      const one = () => {
        if (args.length !== 1) throw new Error(`Function "${name}" expects 1 argument`)
        return args[0] as string
      }
      switch (name) {
        // Excel's ATAN2 takes x first.
        case 'atan2':
          if (args.length !== 2) throw new Error('Function "atan2" expects 2 arguments')
          return `ATAN2(${args[1]},${args[0]})`
        case 'log':
          if (args.length === 1) return `LN(${args[0]})`
          if (args.length === 2) return `LOG(${args[0]},${args[1]})`
          throw new Error('Function "log" expects 1 or 2 arguments')
        case 'floor':
          return `INT(${one()})`
        case 'ceil':
          return `(-INT(-${one()}))`
        case 'round':
          if (args.length < 1 || args.length > 2) throw new Error('Function "round" expects 1 or 2 arguments')
          return `ROUND(${args[0]},${args[1] ?? 0})`
        case 'min':
        case 'max':
          if (!args.length) throw new Error(`Function "${name}" expects at least 1 argument`)
          return `${name.toUpperCase()}(${args.join(',')})`
      }
      const f = EXCEL_FN[name]
      if (!f) throw new Error(`Function "${name}" is not supported in Excel export`)
      return `${f}(${one()})`
    }
    default:
      throw new Error(`Unsupported expression part: ${node.type}`)
  }
}

/** An Excel formula (without the leading =) for `expr`, with keys replaced by cell references from `ref`. */
export function compileExcel(expr: string, ref: (key: string) => string | undefined): string {
  return compileExcelNode(limitedParse(expr), ref)
}
