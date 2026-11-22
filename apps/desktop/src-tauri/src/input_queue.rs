use std::{
    collections::VecDeque,
    sync::{Condvar, Mutex},
};

const MAX_PACKETS: usize = 128;

#[derive(PartialEq, Eq)]
pub enum InputKind {
    Packet,
    Resize(String),
    Close(String),
    Quit,
    Control,
}

#[derive(Default)]
struct State {
    frames: VecDeque<(InputKind, Vec<u8>)>,
    packets: usize,
    stopped: bool,
}

/// One FIFO so closing cannot overtake a draft packet already accepted.
/// Only renderer packets consume its packet quota, never native lifecycle.
#[derive(Default)]
pub struct InputQueue {
    state: Mutex<State>,
    ready: Condvar,
}

impl InputQueue {
    pub fn push(&self, kind: InputKind, frame: Vec<u8>) -> Result<(), &'static str> {
        let mut state = self.state.lock().unwrap();
        if state.stopped {
            return Err("Bun host input disconnected");
        }
        match &kind {
            InputKind::Packet => {
                if state.packets == MAX_PACKETS {
                    return Err("Bun host input queue is full");
                }
                state.packets += 1;
            }
            InputKind::Resize(_) => {
                if let Some(index) = state.frames.iter().position(|(key, _)| *key == kind) {
                    state.frames.remove(index);
                }
            }
            InputKind::Close(_) | InputKind::Quit => {
                if state.frames.iter().any(|(key, _)| *key == kind) {
                    return Ok(());
                }
            }
            InputKind::Control => {}
        }
        state.frames.push_back((kind, frame));
        self.ready.notify_one();
        Ok(())
    }

    pub fn next(&self) -> Option<Vec<u8>> {
        let mut state = self
            .ready
            .wait_while(self.state.lock().unwrap(), |s| {
                !s.stopped && s.frames.is_empty()
            })
            .unwrap();
        let (kind, frame) = state.frames.pop_front()?;
        if kind == InputKind::Packet {
            state.packets -= 1;
        }
        Some(frame)
    }

    pub fn stop(&self) {
        let mut state = self.state.lock().unwrap();
        state.stopped = true;
        state.frames.clear();
        self.ready.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::{InputKind::*, InputQueue, MAX_PACKETS};

    #[test]
    fn resize_flood_and_full_packet_queue_do_not_drop_or_overtake_close() {
        let queue = InputQueue::default();
        for _ in 0..MAX_PACKETS {
            queue.push(Packet, vec![1]).unwrap();
        }
        assert!(queue.push(Packet, vec![2]).is_err());
        for _ in 0..1000 {
            queue.push(Resize("a".into()), vec![3]).unwrap();
        }
        queue.push(Resize("b".into()), vec![4]).unwrap();
        queue.push(Close("a".into()), vec![5]).unwrap();
        queue.push(Close("a".into()), vec![5]).unwrap();
        queue.push(Control, vec![6]).unwrap();
        queue.push(Resize("a".into()), vec![7]).unwrap();
        queue.push(Quit, vec![8]).unwrap();
        queue.push(Quit, vec![8]).unwrap();
        for _ in 0..MAX_PACKETS {
            assert_eq!(queue.next(), Some(vec![1]));
        }
        for value in 4..=8 {
            assert_eq!(queue.next(), Some(vec![value]));
        }
        assert!(queue.state.lock().unwrap().frames.is_empty());
        queue.stop();
        assert_eq!(queue.next(), None);
        assert!(queue.push(Quit, vec![9]).is_err());
    }
}
