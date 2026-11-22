import { describe, expect, it } from 'vitest'

import {
  addLabelOption,
  removeLabelOption,
  toggleLabelSelection,
} from './labelOptions'

const OPTIONS = ['Love', 'Pride', 'Fear']

describe('toggleLabelSelection', () => {
  it('adds and removes options, keeping the habit order', () => {
    let selected = toggleLabelSelection(OPTIONS, [], 'Fear')
    selected = toggleLabelSelection(OPTIONS, selected, 'Love')
    expect(selected).toEqual(['Love', 'Fear'])

    selected = toggleLabelSelection(OPTIONS, selected, 'Fear')
    expect(selected).toEqual(['Love'])
  })

  it('drops selected options that no longer exist', () => {
    expect(toggleLabelSelection(['Love'], ['Love', 'Gone'], 'Pride')).toEqual([
      'Love',
    ])
  })
})

describe('addLabelOption', () => {
  it('appends a trimmed new label', () => {
    expect(addLabelOption(OPTIONS, '  Joy ')).toEqual([...OPTIONS, 'Joy'])
  })

  it('refuses empty names, commas and over-long names', () => {
    expect(() => addLabelOption(OPTIONS, '   ')).toThrow('Type a name')
    expect(() => addLabelOption(OPTIONS, 'Joy, Hope')).toThrow('comma')
    expect(() => addLabelOption(OPTIONS, 'x'.repeat(51))).toThrow(
      'cannot exceed 50 characters',
    )
    expect(addLabelOption(OPTIONS, 'x'.repeat(50))).toHaveLength(4)
  })

  it('refuses a label that already exists, ignoring case', () => {
    expect(() => addLabelOption(OPTIONS, 'pride')).toThrow(
      'The label "Pride" already exists.',
    )
  })
})

describe('removeLabelOption', () => {
  it('removes the label', () => {
    expect(removeLabelOption(OPTIONS, 'Pride')).toEqual(['Love', 'Fear'])
  })

  it('refuses to remove the last label or an unknown one', () => {
    expect(() => removeLabelOption(['Love'], 'Love')).toThrow(
      'at least one label',
    )
    expect(() => removeLabelOption(OPTIONS, 'Joy')).toThrow('does not exist')
  })
})
